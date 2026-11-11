// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IBudgets } from "../../../../../src/interfaces/IBudgets.sol";
import { IPayments } from "../../../../../src/interfaces/IPayments.sol";

import { Budgets_Shared_Test } from "../../../../utils/Budgets/Budgets_Shared_Test.sol";

/// @notice spec/budgets.md `execute` (M4; B9, B13, B14, B15, D10).
contract Execute_Budgets_Unit_Concrete_Test is Budgets_Shared_Test {
    uint128 internal constant AMOUNT = 15_000e6;

    uint256 internal sid;
    uint64 internal payAt;

    function test_WhenACallIntoBudgetsIsAlreadyRunning() external {
        // it should revert with ReentrantCall
        _assertLockRefuses(abi.encodeCall(IBudgets.execute, (1)));
    }

    function test_WhenTheScheduledPaymentDoesNotExist() external {
        _tree();
        // it should revert with UnknownScheduled
        vm.expectRevert(abi.encodeWithSelector(IBudgets.UnknownScheduled.selector, uint256(999)));
        budgets.execute(999);
    }

    modifier whenThePaymentIsNotPending() {
        _tree();
        _scheduleOne();
        _;
    }

    function test_GivenItWasCancelled() external whenThePaymentIsNotPending {
        vm.prank(users.jordan);
        budgets.cancel(sid);
        vm.warp(payAt);
        // it should revert with NotPending
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotPending.selector, sid));
        budgets.execute(sid);
    }

    function test_GivenItWasAlreadyPaid() external whenThePaymentIsNotPending {
        vm.warp(payAt);
        budgets.execute(sid);
        uint256 bobAfterFirst = usdc.balanceOf(users.bob);
        // it should revert with NotPending and pay nothing twice
        vm.prank(users.eve);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotPending.selector, sid));
        budgets.execute(sid);
        assertEq(usdc.balanceOf(users.bob), bobAfterFirst, "paid once");
        assertEq(payments.sends(), 1, "one payment");
        assertEq(_budget(offsite).ownSpent, AMOUNT, "spent once");
    }

    function test_WhenThePayDateHasNotCome() external {
        _tree();
        _scheduleOne();
        vm.warp(payAt - 1);
        // it should revert with NotDue with the pay date
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotDue.selector, sid, payAt));
        budgets.execute(sid);
        assertEq(uint8(_scheduled(sid).state), uint8(IBudgets.ScheduleState.Pending), "still pending");
    }

    modifier whenThePaymentIsPendingAndItsPayDateHasCome() {
        _tree();
        _scheduleOne();
        _;
    }

    function test_WhenThePaymentIsPendingAndItsPayDateHasCome() external whenThePaymentIsPendingAndItsPayDateHasCome {
        vm.warp(payAt);
        uint128 usedBefore = _used(offsite);
        uint256 bobBefore = usdc.balanceOf(users.bob);
        IPayments.PaymentItem memory item = _item(users.bob, address(usdc), AMOUNT, 1, DOC, _scheduledJob(sid));

        // it should pay through the payout role with the scheduled job nonce and the Safe as executor
        _expectPayout(item);
        // it should emit ScheduledPaid
        vm.expectEmit(true, true, true, true, address(budgets));
        emit IBudgets.ScheduledPaid(address(safe), offsite, sid, item.paymentId);
        // it should let anyone call it
        vm.prank(users.eve);
        bytes32 paymentId = budgets.execute(sid);

        // it should return the payment id
        assertEq(paymentId, item.paymentId, "payment id");
        assertTrue(payments.paid(paymentId), "consumed");
        assertEq(usdc.balanceOf(users.bob), bobBefore + AMOUNT, "Bob paid");
        // it should move the amount from ownCommitted to ownSpent on the budget
        assertEq(_budget(offsite).ownCommitted, 0, "ownCommitted");
        assertEq(_budget(offsite).ownSpent, AMOUNT, "ownSpent");
        // it should move the amount from committed to spent on the budget and every budget above it
        uint256[4] memory path = [offsite, operations, operating, top];
        for (uint256 i; i < 4; ++i) {
            assertEq(_budget(path[i]).committed, 0, "committed up the tree");
            assertEq(_budget(path[i]).spent, AMOUNT, "spent up the tree");
        }
        // it should not grow what the budget uses
        assertEq(_used(offsite), usedBefore, "B1's sum unchanged");
        assertEq(uint8(_scheduled(sid).state), uint8(IBudgets.ScheduleState.Paid), "Paid");

        // it should mark the payment Paid before the payout call
        uint256 r = _reentrantBudget();
        vm.prank(address(safe));
        uint256 rSid = budgets.schedule(r, users.bob, 1e6, 0, uint64(block.timestamp + 1), DOC, _nextJob());
        vm.warp(block.timestamp + 1);
        reentrantToken.arm(address(budgets), abi.encodeCall(IBudgets.scheduledOf, (rSid)));
        budgets.execute(rSid);
        assertTrue(reentrantToken.reentrySucceeded(), "a view is not locked");
        IBudgets.Scheduled memory seen = abi.decode(reentrantToken.reentryResult(), (IBudgets.Scheduled));
        assertEq(uint8(seen.state), uint8(IBudgets.ScheduleState.Paid), "Paid before the token moved");
    }

    function test_GivenThePeriodHasTurnedSinceTheBudgetWasLastUsed()
        external
        whenThePaymentIsPendingAndItsPayDateHasCome
    {
        // Offsite spent 5,000 in 2026; a second payment is due in January 2027.
        _spend(users.jordan, offsite, 5000e6);
        vm.prank(users.jordan);
        budgets.cancel(sid);
        uint64 january = _timestamp(2027, 1, 15);
        uint256 next = _schedule(users.jordan, offsite, AMOUNT, january);
        vm.warp(january);
        // it should roll every stale budget up the tree before moving the amount
        budgets.execute(next);
        uint256[4] memory path = [offsite, operations, operating, top];
        for (uint256 i; i < 4; ++i) {
            IBudgets.Budget memory b = _budget(path[i]);
            assertEq(b.spent, AMOUNT, "only the 2027 payment");
            assertEq(b.committed, 0, "reservation consumed");
            assertEq(b.periodIndex, 2027, "rolled");
        }
        assertEq(_budget(offsite).ownSpent, AMOUNT, "own spend is 2027's");
    }

    function test_GivenTheBudgetOrABudgetAboveItIsClosed() external whenThePaymentIsPendingAndItsPayDateHasCome {
        _close(address(safe), operating);
        _close(users.jordan, offsite);
        vm.warp(payAt);
        // it should still pay
        uint256 bobBefore = usdc.balanceOf(users.bob);
        budgets.execute(sid);
        assertEq(usdc.balanceOf(users.bob), bobBefore + AMOUNT, "paid from a closed budget (B9)");
    }

    function test_GivenTheHatThatScheduledItWasChangedOrItsWearerLostIt()
        external
        whenThePaymentIsPendingAndItsPayDateHasCome
    {
        vm.prank(users.amira);
        budgets.setHat(offsite, SPARE_HAT);
        hats.setWearer(OPS_HAT, users.jordan, false);
        vm.warp(payAt);
        // it should still pay
        uint256 bobBefore = usdc.balanceOf(users.bob);
        budgets.execute(sid);
        assertEq(usdc.balanceOf(users.bob), bobBefore + AMOUNT, "paid");
    }

    function test_WhenRolesOrTheTokenRefusesThePayout() external whenThePaymentIsPendingAndItsPayDateHasCome {
        vm.warp(payAt);
        // it should revert whole and leave the payment Pending
        // 1. Roles refuses.
        payoutRoles.setRefuseAll(true);
        vm.expectRevert();
        budgets.execute(sid);
        _assertUntouched();
        payoutRoles.setRefuseAll(false);

        // 2. The token refuses: the Safe cannot cover it.
        uint256 held = usdc.balanceOf(address(safe));
        usdc.burn(address(safe), held);
        vm.expectRevert();
        budgets.execute(sid);
        _assertUntouched();

        // Once the Safe is funded again, the same payment goes through.
        usdc.mint(address(safe), held);
        budgets.execute(sid);
        assertEq(uint8(_scheduled(sid).state), uint8(IBudgets.ScheduleState.Paid), "paid later");
    }

    function test_WhenTheTokenRe_entersBudgetsDuringThePayout() external whenThePaymentIsPendingAndItsPayDateHasCome {
        uint256 r = _reentrantBudget();
        vm.prank(address(safe));
        uint256 rSid = budgets.schedule(r, users.bob, 3e6, 0, uint64(block.timestamp + 1), DOC, _nextJob());
        vm.warp(block.timestamp + 1);
        uint256 bobBefore = reentrantToken.balanceOf(users.bob);
        // The token tries to pay the same scheduled payment a second time.
        reentrantToken.arm(address(budgets), abi.encodeCall(IBudgets.execute, (rSid)));
        budgets.execute(rSid);
        // it should revert the inner call with ReentrantCall
        _assertReentryWasRefused();
        assertEq(reentrantToken.balanceOf(users.bob), bobBefore + 3e6, "paid exactly once");
    }

    function _scheduleOne() internal {
        payAt = uint64(block.timestamp + 30 days);
        sid = _schedule(users.jordan, offsite, AMOUNT, payAt);
    }

    function _assertUntouched() internal view {
        assertEq(uint8(_scheduled(sid).state), uint8(IBudgets.ScheduleState.Pending), "still Pending");
        assertEq(_budget(offsite).ownCommitted, AMOUNT, "still reserved");
        assertEq(_budget(offsite).ownSpent, 0, "nothing spent");
        assertEq(payments.sends(), 0, "nothing paid");
    }
}
