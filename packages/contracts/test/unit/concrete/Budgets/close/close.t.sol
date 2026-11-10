// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IBudgets } from "../../../../../src/interfaces/IBudgets.sol";

import { Budgets_Shared_Test } from "../../../../utils/Budgets/Budgets_Shared_Test.sol";

/// @notice spec/budgets.md `close` (B3, B9, H3). Ports the shape of Firm `Budget.t.sol`
/// testDisablingAllowanceBreaksChain and testOnlyParentAdminCanDisableAllowance.
contract Close_Budgets_Unit_Concrete_Test is Budgets_Shared_Test {
    function test_WhenACallIntoBudgetsIsAlreadyRunning() external {
        // it should revert with ReentrantCall
        _assertLockRefuses(abi.encodeCall(IBudgets.close, (1)));
    }

    function test_WhenTheBudgetDoesNotExist() external {
        _tree();
        // it should revert with UnknownBudget
        vm.prank(address(safe));
        vm.expectRevert(abi.encodeWithSelector(IBudgets.UnknownBudget.selector, uint256(999)));
        budgets.close(999);
    }

    function test_WhenTheCallerMayNotManageTheBudget() external {
        _tree();
        // it should revert with NotAuthorised
        // A wearer never manages their own budget through their own hat alone (H3).
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotAuthorised.selector, operations, users.jordan));
        budgets.close(operations);

        vm.prank(users.amira);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotAuthorised.selector, operating, users.amira));
        budgets.close(operating);

        // Only the Safe manages a top budget.
        vm.prank(users.amira);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotAuthorised.selector, top, users.amira));
        budgets.close(top);

        vm.prank(users.eve);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotAuthorised.selector, offsite, users.eve));
        budgets.close(offsite);
    }

    function test_WhenTheBudgetIsAlreadyClosed() external {
        _tree();
        _close(users.amira, operations);
        // it should revert with AlreadyClosed
        vm.prank(users.amira);
        vm.expectRevert(IBudgets.AlreadyClosed.selector);
        budgets.close(operations);
    }

    function test_WhenTheBudgetIsOpen() external {
        _tree();
        // Before closing: a payment scheduled on Offsite and an agreement reservation on Offsite.
        uint64 payAt = uint64(block.timestamp + 7 days);
        uint256 sid = _schedule(users.jordan, offsite, 1000e6, payAt);
        _commit(offsite, 2000e6);
        uint128 operatingChildren = _budget(operating).childrenAmount;

        // it should emit BudgetClosed
        vm.expectEmit(true, true, true, true, address(budgets));
        emit IBudgets.BudgetClosed(address(safe), operations);
        _close(users.amira, operations);

        // it should mark it closed
        assertTrue(_budget(operations).closed, "closed");
        assertFalse(_budget(offsite).closed, "a child keeps its own flag");
        // it should keep its amount counted in its parent's childrenAmount
        assertEq(_budget(operating).childrenAmount, operatingChildren, "parent's childrenAmount unchanged");

        // it should stop spends and schedules and commitments and children on it and every budget under it
        uint256[2] memory shut = [operations, offsite];
        for (uint256 i; i < 2; ++i) {
            bytes memory closedErr = abi.encodeWithSelector(IBudgets.BudgetIsClosed.selector, operations);
            vm.prank(users.jordan);
            vm.expectRevert(closedErr);
            budgets.spend(shut[i], users.alice, 1, 0, DOC, JOB);

            vm.prank(users.jordan);
            vm.expectRevert(closedErr);
            budgets.schedule(shut[i], users.alice, 1, 0, payAt, DOC, _nextJob());

            vm.prank(agreements);
            vm.expectRevert(closedErr);
            budgets.commit(shut[i], 1);

            vm.prank(users.jordan);
            vm.expectRevert(closedErr);
            budgets.createChildBudget(shut[i], 1, SPARE_HAT);
        }

        // it should let pending scheduled payments still execute
        vm.warp(payAt);
        vm.prank(users.eve);
        budgets.execute(sid);
        assertEq(uint8(_scheduled(sid).state), uint8(IBudgets.ScheduleState.Paid), "executed while closed");

        // it should let running agreements still collect
        uint256 aliceBefore = usdc.balanceOf(users.alice);
        vm.prank(agreements);
        budgets.payReserved(offsite, users.alice, 500e6, DOC, JOB);
        assertEq(usdc.balanceOf(users.alice), aliceBefore + 500e6, "collected while closed");
    }
}
