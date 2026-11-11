// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IBudgets } from "../../../../../src/interfaces/IBudgets.sol";
import { ICalendar } from "../../../../../src/interfaces/ICalendar.sol";

import { Budgets_Shared_Test } from "../../../../utils/Budgets/Budgets_Shared_Test.sol";

/// @notice spec/budgets.md `createTopBudget` (Board only, H4).
contract CreateTopBudget_Budgets_Unit_Concrete_Test is Budgets_Shared_Test {
    function test_WhenACallIntoBudgetsIsAlreadyRunning() external {
        // it should revert with ReentrantCall
        _assertLockRefuses(abi.encodeCall(IBudgets.createTopBudget, (address(usdc), YEAR, 1, BOARD_HAT)));
    }

    function test_WhenTheCallerIsNotAConfiguredSafe() external {
        budgets.setAgreements(agreements);
        // it should revert with NotConfigured
        vm.prank(address(safe));
        vm.expectRevert(IBudgets.NotConfigured.selector);
        budgets.createTopBudget(address(usdc), YEAR, TOP_AMOUNT, BOARD_HAT);

        // Another Safe's configuration does not count: Eve has none.
        vm.prank(address(safe));
        budgets.configure(address(payoutRoles), ROLE_KEY);
        vm.prank(users.eve);
        vm.expectRevert(IBudgets.NotConfigured.selector);
        budgets.createTopBudget(address(usdc), YEAR, TOP_AMOUNT, BOARD_HAT);
    }

    modifier whenTheCallerIsAConfiguredSafe() {
        _wire();
        _;
    }

    function test_WhenTheTokenIsTheZeroAddressOrHasNoCode() external whenTheCallerIsAConfiguredSafe {
        // it should revert with InvalidToken
        vm.prank(address(safe));
        vm.expectRevert(IBudgets.InvalidToken.selector);
        budgets.createTopBudget(address(0), YEAR, TOP_AMOUNT, BOARD_HAT);

        address noCode = makeAddr("no code");
        vm.prank(address(safe));
        vm.expectRevert(IBudgets.InvalidToken.selector);
        budgets.createTopBudget(noCode, YEAR, TOP_AMOUNT, BOARD_HAT);
    }

    function test_WhenTheBudgetPeriodIsNotABudgetPeriod() external whenTheCallerIsAConfiguredSafe {
        // it should revert with the Calendar's InvalidBudgetPeriod
        vm.prank(address(safe));
        vm.expectRevert(abi.encodeWithSelector(ICalendar.InvalidBudgetPeriod.selector, uint8(3)));
        budgets.createTopBudget(address(usdc), 3, TOP_AMOUNT, BOARD_HAT);

        vm.prank(address(safe));
        vm.expectRevert(abi.encodeWithSelector(ICalendar.InvalidBudgetPeriod.selector, uint8(255)));
        budgets.createTopBudget(address(usdc), 255, TOP_AMOUNT, BOARD_HAT);
    }

    function test_WhenTheHatIs0() external whenTheCallerIsAConfiguredSafe {
        // it should revert with InvalidHat
        vm.prank(address(safe));
        vm.expectRevert(IBudgets.InvalidHat.selector);
        budgets.createTopBudget(address(usdc), YEAR, TOP_AMOUNT, 0);
    }

    modifier whenTheInputsAreValid() {
        _;
    }

    function test_WhenTheInputsAreValid() external whenTheCallerIsAConfiguredSafe whenTheInputsAreValid {
        // it should emit BudgetCreated
        vm.expectEmit(true, true, true, true, address(budgets));
        emit IBudgets.BudgetCreated(address(safe), 1, 0, address(usdc), QUARTER, TOP_AMOUNT, BOARD_HAT);
        vm.prank(address(safe));
        uint256 id = budgets.createTopBudget(address(usdc), QUARTER, TOP_AMOUNT, BOARD_HAT);

        // it should return the next budget id
        assertEq(id, 1, "first id is 1");
        assertEq(budgets.budgetCount(), 1, "budgetCount");
        assertEq(_createTop(address(dai), MONTH, 1, BOARD_HAT), 2, "then 2");

        // it should create a budget with no parent at depth 1
        IBudgets.Budget memory b = _budget(id);
        assertEq(b.safe, address(safe), "safe");
        assertEq(b.parent, 0, "no parent");
        assertEq(b.depth, 1, "depth 1");
        assertEq(b.token, address(usdc), "token");
        assertEq(b.period, QUARTER, "period");
        assertEq(b.amount, TOP_AMOUNT, "amount");
        assertFalse(b.closed, "open");
        assertEq(b.childrenAmount + b.ownSpent + b.ownCommitted + b.spent + b.committed, 0, "nothing used");
        assertEq(budgets.leftOf(id), TOP_AMOUNT, "all of it left");
        assertEq(budgets.pathOf(id).length, 1, "path is itself");
        assertEq(budgets.pathOf(id)[0], id, "path is itself");
        assertEq(budgets.childrenOf(id).length, 0, "no children");
        // it should store the hat
        assertEq(b.hat, BOARD_HAT, "hat");
        // it should set its period index to the current period
        assertEq(b.periodIndex, _periodIndex(QUARTER, block.timestamp), "period index");
        assertEq(b.periodIndex, 2026 * 4, "Q1 2026");
    }

    function test_GivenTheAmountIs0() external whenTheCallerIsAConfiguredSafe whenTheInputsAreValid {
        uint256 id = _createTop(address(usdc), YEAR, 0, BOARD_HAT);
        // it should create the budget with nothing to spend
        assertEq(_budget(id).amount, 0, "amount 0");
        assertEq(budgets.leftOf(id), 0, "nothing left");
        vm.prank(address(safe));
        vm.expectRevert(abi.encodeWithSelector(IBudgets.OverBudget.selector, id, uint128(0), uint128(1)));
        budgets.spend(id, users.alice, 1, 0, DOC, JOB);
    }
}
