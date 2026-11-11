// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IBudgets } from "../../../../../src/interfaces/IBudgets.sol";

import { Budgets_Shared_Test } from "../../../../utils/Budgets/Budgets_Shared_Test.sol";

/// @notice spec/budgets.md "The walk is a loop with a constant bound" and "Who may act" at `MAX_DEPTH`: from
/// a budget at depth 8, every walk (authority, B3, the period roll and B2's sums) must reach the top budget,
/// seven steps up. No tree: these leaves add no function; they pin the loop bound the other suites never
/// reach (a walk one step short passed every other Budgets test).
contract MaxDepth_Budgets_Unit_Concrete_Test is Budgets_Shared_Test {
    uint256 internal deepest;
    uint256[8] internal path;

    /// @dev Top (CEO hat, Amira) and six budgets under a hat no one wears, then the deepest (Ops, Jordan).
    function _deepChain() internal {
        _wire();
        top = _createTop(address(usdc), YEAR, TOP_AMOUNT, CEO_HAT);
        path[0] = top;
        uint256 id = top;
        uint128 amount = TOP_AMOUNT;
        for (uint256 d = 2; d <= 8; ++d) {
            amount -= 1000e6;
            id = _createChild(address(safe), id, amount, d == 8 ? OPS_HAT : SPARE_HAT);
            path[d - 1] = id;
        }
        deepest = id;
        assertEq(_budget(deepest).depth, 8, "depth 8");
    }

    function test_TheTopBudgetsHatReachesTheDeepestBudget() external {
        _deepChain();
        assertTrue(budgets.authorised(deepest, users.amira), "the top's hat, seven levels up");
        assertFalse(budgets.authorised(deepest, users.eve), "no hat on the path");

        _spend(users.amira, deepest, 1000e6);
        assertEq(_budget(deepest).ownSpent, 1000e6, "Amira spent from depth 8");

        vm.prank(users.amira);
        budgets.setAmount(deepest, 500_000e6);
        assertEq(_budget(deepest).amount, 500_000e6, "Amira manages depth 8 through the top's hat");

        uint256 sid = _schedule(users.amira, deepest, 2000e6, uint64(block.timestamp + 1 days));
        vm.prank(users.amira);
        budgets.cancel(sid);
        assertEq(uint8(_scheduled(sid).state), uint8(IBudgets.ScheduleState.Cancelled), "Amira cancelled");
    }

    function test_AClosedTopBlocksTheDeepestBudget() external {
        _deepChain();
        _close(address(safe), top);
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.BudgetIsClosed.selector, top));
        budgets.spend(deepest, users.alice, 1, 0, DOC, JOB);

        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.BudgetIsClosed.selector, top));
        budgets.schedule(deepest, users.bob, 1, 0, uint64(block.timestamp + 1 days), DOC, _nextJob());

        vm.prank(agreements);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.BudgetIsClosed.selector, top));
        budgets.commit(deepest, 1);
    }

    function test_ASpendAtDepth8RollsAndCountsUpToTheTop() external {
        _deepChain();
        _spend(users.jordan, deepest, 15_000e6);
        for (uint256 i; i < 8; ++i) {
            assertEq(_budget(path[i]).spent, 15_000e6, "2026 spend counted on the whole path (B2)");
        }

        vm.warp(_timestamp(2027, 1, 1));
        _spend(users.jordan, deepest, 4000e6);
        for (uint256 i; i < 8; ++i) {
            IBudgets.Budget memory b = budgets.budgetOf(path[i]);
            assertEq(b.spent, 4000e6, "only 2027's spend, on every budget up to the top");
            assertEq(b.periodIndex, 2027, "rolled to 2027");
        }

        uint256[] memory p = budgets.pathOf(deepest);
        assertEq(p.length, 8, "path length");
        for (uint256 i; i < 8; ++i) {
            assertEq(p[i], path[i], "path, top first");
        }
    }

    function test_ACancelAndAnExecuteAtDepth8MoveTheTopsCommitted() external {
        _deepChain();
        uint64 payAt = uint64(block.timestamp + 1 days);
        uint256 sid = _schedule(users.jordan, deepest, 3000e6, payAt);
        assertEq(_budget(top).committed, 3000e6, "reserved at the top");
        vm.warp(payAt);
        budgets.execute(sid);
        assertEq(_budget(top).committed, 0, "the top's reservation consumed");
        assertEq(_budget(top).spent, 3000e6, "the top's spend");
    }
}
