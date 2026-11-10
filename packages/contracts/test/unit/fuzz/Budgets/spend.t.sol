// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IBudgets } from "../../../../src/interfaces/IBudgets.sol";

import { Budgets_Shared_Test } from "../../../utils/Budgets/Budgets_Shared_Test.sol";

/// @notice spend.tree over its input ranges: any amount against what is left, every kind, and spends
/// either side of a period boundary at any time of year (B1, B2, B11).
contract Spend_Budgets_Unit_Fuzz_Test is Budgets_Shared_Test {
    function testFuzz_PaysIffWithinLeft(uint128 first, uint128 second, uint16 kind) external {
        _tree();
        kind = uint16(bound(kind, 0, 3));
        first = uint128(bound(first, 1, OFFSITE_AMOUNT));
        _spend(users.jordan, offsite, first);
        uint128 left = OFFSITE_AMOUNT - first;
        assertEq(budgets.leftOf(offsite), left, "left after the first spend");

        vm.prank(users.jordan);
        if (second == 0) {
            vm.expectRevert(IBudgets.ZeroAmount.selector);
            budgets.spend(offsite, users.alice, second, kind, DOC, JOB);
        } else if (second > left) {
            vm.expectRevert(abi.encodeWithSelector(IBudgets.OverBudget.selector, offsite, left, second));
            budgets.spend(offsite, users.alice, second, kind, DOC, JOB);
        } else {
            budgets.spend(offsite, users.alice, second, kind, DOC, JOB);
            assertEq(_budget(offsite).ownSpent, first + second, "ownSpent");
            assertEq(_budget(top).spent, first + second, "spent at the top (B2)");
        }
    }

    function testFuzz_RefusesEveryKindAbove3(uint16 kind) external {
        _tree();
        kind = uint16(bound(kind, 4, type(uint16).max));
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.InvalidKind.selector, kind));
        budgets.spend(offsite, users.alice, 1, kind, DOC, JOB);
    }

    function testFuzz_OwnSpendStartsAtZeroInEveryNewPeriod(uint8 period, uint64 gap, uint128 amount) external {
        period = uint8(bound(period, 0, 2));
        _tree(period);
        _spend(users.jordan, offsite, OFFSITE_AMOUNT);
        gap = uint64(bound(gap, 1, 3 * 365 days));
        uint256 t = block.timestamp + gap;
        vm.warp(t);
        amount = uint128(bound(amount, 1, OFFSITE_AMOUNT));
        bool turned = _periodIndex(period, t) != _periodIndex(period, START);
        if (turned) {
            _spend(users.jordan, offsite, amount);
            assertEq(_budget(offsite).ownSpent, amount, "own spend restarted (B11)");
            assertEq(_budget(top).spent, amount, "spent restarted up the tree");
        } else {
            vm.prank(users.jordan);
            vm.expectRevert(abi.encodeWithSelector(IBudgets.OverBudget.selector, offsite, uint128(0), amount));
            budgets.spend(offsite, users.alice, amount, 0, DOC, JOB);
        }
    }
}
