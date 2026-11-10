// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IBudgets } from "../../../../../src/interfaces/IBudgets.sol";

import { Budgets_Shared_Test } from "../../../../utils/Budgets/Budgets_Shared_Test.sol";

/// @notice spec/budgets.md `cancel` (M4, F1: cancel any time until paid; B13, B14, B15).
contract Cancel_Budgets_Unit_Concrete_Test is Budgets_Shared_Test {
    uint128 internal constant AMOUNT = 15_000e6;

    uint256 internal sid;
    uint64 internal payAt;

    function test_WhenACallIntoBudgetsIsAlreadyRunning() external {
        // it should revert with ReentrantCall
        _assertLockRefuses(abi.encodeCall(IBudgets.cancel, (1)));
    }

    function test_WhenTheScheduledPaymentDoesNotExist() external {
        _tree();
        // it should revert with UnknownScheduled
        vm.prank(address(safe));
        vm.expectRevert(abi.encodeWithSelector(IBudgets.UnknownScheduled.selector, uint256(999)));
        budgets.cancel(999);
    }

    function test_WhenTheCallerIsNotAuthorisedForThePaymentsBudget() external {
        _treeWithSibling(YEAR);
        _scheduleOne();
        // it should revert with NotAuthorised
        vm.prank(users.eve);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotAuthorised.selector, offsite, users.eve));
        budgets.cancel(sid);

        vm.prank(users.ben);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotAuthorised.selector, offsite, users.ben));
        budgets.cancel(sid);
    }

    modifier whenThePaymentIsNotPending() {
        _tree();
        _scheduleOne();
        _;
    }

    function test_GivenItWasCancelled() external whenThePaymentIsNotPending {
        vm.prank(users.jordan);
        budgets.cancel(sid);
        // it should revert with NotPending
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotPending.selector, sid));
        budgets.cancel(sid);
        assertEq(_budget(offsite).ownCommitted, 0, "freed once, not twice");
    }

    function test_GivenItWasPaid() external whenThePaymentIsNotPending {
        vm.warp(payAt);
        budgets.execute(sid);
        // it should revert with NotPending
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotPending.selector, sid));
        budgets.cancel(sid);
        assertEq(_budget(offsite).ownSpent, AMOUNT, "the payment stays spent");
    }

    modifier whenThePaymentIsPending() {
        _tree();
        _scheduleOne();
        _;
    }

    function test_WhenThePaymentIsPending() external whenThePaymentIsPending {
        // it should emit ScheduleCancelled
        vm.expectEmit(true, true, true, true, address(budgets));
        emit IBudgets.ScheduleCancelled(address(safe), offsite, sid);
        vm.prank(users.jordan);
        budgets.cancel(sid);

        // it should subtract the amount from ownCommitted on the budget
        assertEq(_budget(offsite).ownCommitted, 0, "ownCommitted");
        // it should subtract the amount from committed on the budget and every budget above it
        uint256[4] memory path = [offsite, operations, operating, top];
        for (uint256 i; i < 4; ++i) {
            assertEq(_budget(path[i]).committed, 0, "committed up the tree");
        }
        assertEq(budgets.leftOf(offsite), OFFSITE_AMOUNT, "the room is back");
        // it should mark the payment Cancelled
        assertEq(uint8(_scheduled(sid).state), uint8(IBudgets.ScheduleState.Cancelled), "Cancelled");
    }

    function test_GivenTheBudgetIsClosed() external whenThePaymentIsPending {
        _close(address(safe), operating);
        // it should still cancel
        vm.prank(users.jordan);
        budgets.cancel(sid);
        assertEq(uint8(_scheduled(sid).state), uint8(IBudgets.ScheduleState.Cancelled), "cancelled while closed");
        assertEq(_budget(offsite).ownCommitted, 0, "freed");
    }

    function test_GivenItsPayDateHasPassedAndNoOneHasExecutedIt() external whenThePaymentIsPending {
        vm.warp(payAt + 10 days);
        // it should still cancel
        vm.prank(users.jordan);
        budgets.cancel(sid);
        assertEq(uint8(_scheduled(sid).state), uint8(IBudgets.ScheduleState.Cancelled), "cancelled after payAt (F1)");
        // and then it can never be paid
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotPending.selector, sid));
        budgets.execute(sid);
    }

    function test_GivenTheCallerWearsTheHatOfABudgetAbove() external whenThePaymentIsPending {
        // it should allow it
        vm.prank(users.amira);
        budgets.cancel(sid);
        assertEq(uint8(_scheduled(sid).state), uint8(IBudgets.ScheduleState.Cancelled), "the CEO cancels");
    }

    function _scheduleOne() internal {
        payAt = uint64(block.timestamp + 30 days);
        sid = _schedule(users.jordan, offsite, AMOUNT, payAt);
    }
}
