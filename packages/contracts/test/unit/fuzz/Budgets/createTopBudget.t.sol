// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IBudgets } from "../../../../src/interfaces/IBudgets.sol";
import { ICalendar } from "../../../../src/interfaces/ICalendar.sol";

import { Budgets_Shared_Test } from "../../../utils/Budgets/Budgets_Shared_Test.sol";

/// @notice createTopBudget.tree over its input ranges: any amount (0 included), any period code, any
/// time of creation.
contract CreateTopBudget_Budgets_Unit_Fuzz_Test is Budgets_Shared_Test {
    function testFuzz_CreatesWithAnyAmountAndValidPeriod(uint128 amount, uint8 period, uint64 at) external {
        period = uint8(bound(period, 0, 2));
        at = uint64(bound(at, START, _timestamp(2100, 1, 1)));
        vm.warp(at);
        _wire();
        uint256 id = _createTop(address(usdc), period, amount, BOARD_HAT);
        IBudgets.Budget memory b = _budget(id);
        assertEq(b.amount, amount, "amount");
        assertEq(b.period, period, "period");
        assertEq(b.depth, 1, "depth");
        assertEq(b.periodIndex, _periodIndex(period, at), "period index");
        assertEq(budgets.leftOf(id), amount, "left");
    }

    function testFuzz_RefusesAnyPeriodAbove2(uint8 period) external {
        period = uint8(bound(period, 3, type(uint8).max));
        _wire();
        vm.prank(address(safe));
        vm.expectRevert(abi.encodeWithSelector(ICalendar.InvalidBudgetPeriod.selector, period));
        budgets.createTopBudget(address(usdc), period, 1, BOARD_HAT);
    }

    function testFuzz_RefusesAnyCallerButAConfiguredSafe(address caller) external {
        vm.assume(caller != address(safe));
        _wire();
        vm.prank(caller);
        vm.expectRevert(IBudgets.NotConfigured.selector);
        budgets.createTopBudget(address(usdc), YEAR, 1, BOARD_HAT);
    }
}
