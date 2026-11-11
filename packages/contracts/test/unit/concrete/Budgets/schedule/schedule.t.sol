// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IBudgets } from "../../../../../src/interfaces/IBudgets.sol";

import { Budgets_Shared_Test } from "../../../../utils/Budgets/Budgets_Shared_Test.sol";

/// @notice spec/budgets.md `schedule` (M4, F2: the payment kind; B1, B2, B3, B15).
contract Schedule_Budgets_Unit_Concrete_Test is Budgets_Shared_Test {
    function test_WhenACallIntoBudgetsIsAlreadyRunning() external {
        // it should revert with ReentrantCall
        _assertLockRefuses(
            abi.encodeCall(
                IBudgets.schedule, (1, users.eve, 1, 0, uint64(block.timestamp + 1 days), DOC, bytes32("job"))
            )
        );
    }

    function test_WhenTheBudgetDoesNotExist() external {
        _tree();
        // it should revert with UnknownBudget
        vm.prank(address(safe));
        vm.expectRevert(abi.encodeWithSelector(IBudgets.UnknownBudget.selector, uint256(999)));
        budgets.schedule(999, users.bob, 1, 0, uint64(block.timestamp + 1), DOC, _nextJob());
    }

    function test_WhenTheCallerIsNotAuthorisedForTheBudget() external {
        _treeWithSibling(YEAR);
        uint64 payAt = uint64(block.timestamp + 1 days);
        // it should revert with NotAuthorised
        vm.prank(users.eve);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotAuthorised.selector, operations, users.eve));
        budgets.schedule(operations, users.eve, 1, 0, payAt, DOC, _nextJob());

        vm.prank(users.ben);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotAuthorised.selector, operations, users.ben));
        budgets.schedule(operations, users.bob, 1, 0, payAt, DOC, _nextJob());
    }

    modifier whenTheCallerIsAuthorised() {
        _tree();
        _;
    }

    function test_WhenTheBudgetOrAnyBudgetAboveItIsClosed() external whenTheCallerIsAuthorised {
        _close(address(safe), operating);
        // it should revert with BudgetIsClosed naming the nearest closed budget
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.BudgetIsClosed.selector, operating));
        budgets.schedule(offsite, users.bob, 1, 0, uint64(block.timestamp + 1 days), DOC, _nextJob());
    }

    function test_WhenTheRecipientIsTheZeroAddress() external whenTheCallerIsAuthorised {
        // it should revert with ZeroAddress
        vm.prank(users.jordan);
        vm.expectRevert(IBudgets.ZeroAddress.selector);
        budgets.schedule(offsite, address(0), 1, 0, uint64(block.timestamp + 1 days), DOC, _nextJob());
    }

    function test_WhenTheAmountIs0() external whenTheCallerIsAuthorised {
        // it should revert with ZeroAmount
        vm.prank(users.jordan);
        vm.expectRevert(IBudgets.ZeroAmount.selector);
        budgets.schedule(offsite, users.bob, 0, 0, uint64(block.timestamp + 1 days), DOC, _nextJob());
    }

    function test_WhenTheKindIsAbove3() external whenTheCallerIsAuthorised {
        // it should revert with InvalidKind
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.InvalidKind.selector, uint16(4)));
        budgets.schedule(offsite, users.bob, 1, 4, uint64(block.timestamp + 1 days), DOC, _nextJob());
    }

    function test_WhenTheDocumentHashIsZero() external whenTheCallerIsAuthorised {
        // it should revert with ZeroDocumentHash
        vm.prank(users.jordan);
        vm.expectRevert(IBudgets.ZeroDocumentHash.selector);
        budgets.schedule(offsite, users.bob, 1, 0, uint64(block.timestamp + 1 days), bytes32(0), _nextJob());
    }

    function test_WhenTheJobNonceIsZero() external whenTheCallerIsAuthorised {
        // it should revert with ZeroJobNonce
        vm.prank(users.jordan);
        vm.expectRevert(IBudgets.ZeroJobNonce.selector);
        budgets.schedule(offsite, users.bob, 1, 0, uint64(block.timestamp + 1 days), DOC, bytes32(0));
    }

    function test_WhenThePayDateIsNowOrInThePast() external whenTheCallerIsAuthorised {
        // it should revert with InvalidPayAt
        uint64[3] memory dates = [uint64(block.timestamp), uint64(block.timestamp - 1), 0];
        for (uint256 i; i < dates.length; ++i) {
            vm.prank(users.jordan);
            vm.expectRevert(IBudgets.InvalidPayAt.selector);
            budgets.schedule(offsite, users.bob, 1, 0, dates[i], DOC, _nextJob());
        }
    }

    modifier whenTheInputsAreValid() {
        _;
    }

    function test_GivenThePeriodHasTurnedSinceTheBudgetWasLastUsed()
        external
        whenTheCallerIsAuthorised
        whenTheInputsAreValid
    {
        _spend(users.jordan, offsite, OFFSITE_AMOUNT);
        assertEq(budgets.leftOf(offsite), 0, "spent out in 2026");

        vm.warp(_timestamp(2027, 1, 1));
        // it should start ownSpent and spent over at 0 on every stale budget up the tree before checking
        _schedule(users.jordan, offsite, OFFSITE_AMOUNT, uint64(block.timestamp + 1 days));
        uint256[4] memory path = [offsite, operations, operating, top];
        for (uint256 i; i < 4; ++i) {
            IBudgets.Budget memory b = _budget(path[i]);
            assertEq(b.spent, 0, "last year's spend is gone");
            assertEq(b.committed, OFFSITE_AMOUNT, "this year's reservation");
            assertEq(b.periodIndex, 2027, "rolled");
        }
        assertEq(_budget(offsite).ownSpent, 0, "own spend 0");
    }

    function test_WhenTheAmountIsMoreThanIsLeftInTheBudget() external whenTheCallerIsAuthorised whenTheInputsAreValid {
        uint64 payAt = uint64(block.timestamp + 1 days);
        // it should revert with OverBudget with the budget and what is left
        vm.prank(users.jordan);
        vm.expectRevert(
            abi.encodeWithSelector(IBudgets.OverBudget.selector, offsite, OFFSITE_AMOUNT, OFFSITE_AMOUNT + 1)
        );
        budgets.schedule(offsite, users.bob, OFFSITE_AMOUNT + 1, 0, payAt, DOC, _nextJob());

        // A pending payment already holds its amount.
        _schedule(users.jordan, offsite, 15_000e6, payAt);
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.OverBudget.selector, offsite, 5000e6, 5000e6 + 1));
        budgets.schedule(offsite, users.bob, 5000e6 + 1, 0, payAt, DOC, _nextJob());
    }

    function test_WhenTheAmountFitsWhatIsLeft() external whenTheCallerIsAuthorised whenTheInputsAreValid {
        uint128 amount = 15_000e6;
        uint64 payAt = _timestamp(2026, 2, 1);
        uint256 safeBefore = usdc.balanceOf(address(safe));
        uint256 bobBefore = usdc.balanceOf(users.bob);

        bytes32 job = _nextJob();
        // it should emit PaymentScheduled
        vm.expectEmit(true, true, true, true, address(budgets));
        emit IBudgets.PaymentScheduled(address(safe), offsite, 1, users.bob, amount, 3, payAt, DOC, job);
        vm.prank(users.jordan);
        uint256 sid = budgets.schedule(offsite, users.bob, amount, 3, payAt, DOC, job);
        // it should keep the job nonce execute pays with
        assertEq(budgets.scheduledOf(sid).jobNonce, job, "jobNonce");

        // it should return the next scheduled id
        assertEq(sid, 1, "first id");
        assertEq(budgets.scheduledCount(), 1, "scheduledCount");
        assertEq(_schedule(users.jordan, offsite, 1, payAt), 2, "then 2");

        // it should add the amount to ownCommitted on the budget
        assertEq(_budget(offsite).ownCommitted, amount + 1, "ownCommitted");
        // it should add the amount to committed on the budget and every budget above it
        uint256[4] memory path = [offsite, operations, operating, top];
        for (uint256 i; i < 4; ++i) {
            assertEq(_budget(path[i]).committed, amount + 1, "committed up the tree (B2)");
        }
        assertEq(_budget(operations).ownCommitted, 0, "only Offsite's own commitment grew");
        // it should lower what is left in the budget by the amount now
        assertEq(budgets.leftOf(offsite), OFFSITE_AMOUNT - amount - 1, "left");

        // it should store the scheduled payment as Pending with its pay date and document hash
        IBudgets.Scheduled memory s = _scheduled(sid);
        assertEq(s.budgetId, offsite, "budget");
        assertEq(s.to, users.bob, "to");
        assertEq(s.amount, amount, "amount");
        assertEq(s.payAt, payAt, "pay date");
        assertEq(s.kind, 3, "kind (F2)");
        assertEq(uint8(s.state), uint8(IBudgets.ScheduleState.Pending), "Pending");
        assertEq(s.documentHash, DOC, "document hash");

        // it should move no money
        assertEq(usdc.balanceOf(address(safe)), safeBefore, "the Safe paid nothing");
        assertEq(usdc.balanceOf(users.bob), bobBefore, "Bob got nothing yet");
        assertEq(payoutRoles.calls(), 0, "no payout call");
    }
}
