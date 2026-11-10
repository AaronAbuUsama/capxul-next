// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IBudgets } from "../../../../src/interfaces/IBudgets.sol";

import { Budgets_Shared_Test } from "../../../utils/Budgets/Budgets_Shared_Test.sol";

/// @notice cancel.tree over time: a pending payment cancels at any moment until it is paid, before or
/// after its pay date (F1, B14), and frees exactly its amount.
contract Cancel_Budgets_Unit_Fuzz_Test is Budgets_Shared_Test {
    function testFuzz_CancelsAtAnyTimeWhilePending(uint128 amount, uint64 delay, uint64 wait) external {
        _tree();
        amount = uint128(bound(amount, 1, OFFSITE_AMOUNT));
        delay = uint64(bound(delay, 1, 400 days));
        wait = uint64(bound(wait, 0, 800 days));
        uint256 sid = _schedule(users.jordan, offsite, amount, uint64(block.timestamp) + delay);
        vm.warp(block.timestamp + wait);
        vm.prank(users.jordan);
        budgets.cancel(sid);
        assertEq(uint8(_scheduled(sid).state), uint8(IBudgets.ScheduleState.Cancelled), "Cancelled");
        assertEq(_budget(offsite).ownCommitted, 0, "freed");
        assertEq(_budget(top).committed, 0, "freed up the tree");
    }

    function testFuzz_RefusesEveryoneOffThePath(address caller) external {
        _treeWithSibling(YEAR);
        vm.assume(caller != address(safe) && caller != users.amira && caller != users.jordan);
        uint256 sid = _schedule(users.jordan, offsite, 1, uint64(block.timestamp + 1));
        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotAuthorised.selector, offsite, caller));
        budgets.cancel(sid);
    }
}
