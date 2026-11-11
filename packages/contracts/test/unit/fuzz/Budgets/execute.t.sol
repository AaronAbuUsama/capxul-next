// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IBudgets } from "../../../../src/interfaces/IBudgets.sol";

import { Budgets_Shared_Test } from "../../../utils/Budgets/Budgets_Shared_Test.sol";

/// @notice execute.tree over time and callers: never before payAt, at or after it by anyone, at most
/// once (B13, B14), and B1's sum does not grow.
contract Execute_Budgets_Unit_Fuzz_Test is Budgets_Shared_Test {
    function testFuzz_PaysIffDueAndOnlyOnce(uint128 amount, uint64 delay, uint64 at, address caller) external {
        _tree();
        amount = uint128(bound(amount, 1, OFFSITE_AMOUNT));
        delay = uint64(bound(delay, 1, 300 days));
        uint64 payAt = uint64(block.timestamp) + delay;
        uint256 sid = _schedule(users.jordan, offsite, amount, payAt);
        at = uint64(bound(at, block.timestamp, payAt + 30 days));
        vm.warp(at);
        uint128 usedBefore = _used(offsite);

        vm.prank(caller);
        if (at < payAt) {
            vm.expectRevert(abi.encodeWithSelector(IBudgets.NotDue.selector, sid, payAt));
            budgets.execute(sid);
        } else {
            uint256 bobBefore = usdc.balanceOf(users.bob);
            budgets.execute(sid);
            assertEq(usdc.balanceOf(users.bob), bobBefore + amount, "paid");
            assertEq(_used(offsite), usedBefore, "B1's sum does not grow (same period)");
            vm.prank(caller);
            vm.expectRevert(abi.encodeWithSelector(IBudgets.NotPending.selector, sid));
            budgets.execute(sid);
        }
    }
}
