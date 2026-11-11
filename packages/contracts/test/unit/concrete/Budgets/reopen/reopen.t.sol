// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IBudgets } from "../../../../../src/interfaces/IBudgets.sol";

import { Budgets_Shared_Test } from "../../../../utils/Budgets/Budgets_Shared_Test.sol";

/// @notice spec/budgets.md `reopen` (B3, H3).
contract Reopen_Budgets_Unit_Concrete_Test is Budgets_Shared_Test {
    function test_WhenACallIntoBudgetsIsAlreadyRunning() external {
        // it should revert with ReentrantCall
        _assertLockRefuses(abi.encodeCall(IBudgets.reopen, (1)));
    }

    function test_WhenTheBudgetDoesNotExist() external {
        _tree();
        // it should revert with UnknownBudget
        vm.prank(address(safe));
        vm.expectRevert(abi.encodeWithSelector(IBudgets.UnknownBudget.selector, uint256(999)));
        budgets.reopen(999);
    }

    function test_WhenTheCallerMayNotManageTheBudget() external {
        _tree();
        _close(users.amira, operations);
        _close(address(safe), top);
        // it should revert with NotAuthorised
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotAuthorised.selector, operations, users.jordan));
        budgets.reopen(operations);

        vm.prank(users.amira);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotAuthorised.selector, top, users.amira));
        budgets.reopen(top);
    }

    function test_WhenTheBudgetIsNotClosed() external {
        _tree();
        // it should revert with NotClosed
        vm.prank(users.amira);
        vm.expectRevert(IBudgets.NotClosed.selector);
        budgets.reopen(operations);
    }

    modifier whenTheBudgetIsClosed() {
        _tree();
        _close(users.amira, operations);
        _;
    }

    function test_WhenTheBudgetIsClosed() external whenTheBudgetIsClosed {
        // it should emit BudgetReopened
        vm.expectEmit(true, true, true, true, address(budgets));
        emit IBudgets.BudgetReopened(address(safe), operations);
        vm.prank(users.amira);
        budgets.reopen(operations);

        // it should mark it open
        assertFalse(_budget(operations).closed, "open");
        _spend(users.jordan, offsite, 100e6);
        assertEq(_budget(offsite).ownSpent, 100e6, "spends again");
    }

    function test_GivenABudgetAboveItIsStillClosed() external whenTheBudgetIsClosed {
        _close(address(safe), operating);
        vm.prank(users.amira);
        budgets.reopen(operations);
        assertFalse(_budget(operations).closed, "its own flag is open");

        // it should still refuse spends with BudgetIsClosed naming that budget
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.BudgetIsClosed.selector, operating));
        budgets.spend(operations, users.alice, 1, 0, DOC, JOB);
    }
}
