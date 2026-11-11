// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IBudgets } from "../../../../src/interfaces/IBudgets.sol";

import { Budgets_Shared_Test } from "../../../utils/Budgets/Budgets_Shared_Test.sol";

/// @notice commit.tree over amounts: a reservation fits iff it is at most what is left (B1), and any
/// caller but Agreements is refused.
contract Commit_Budgets_Unit_Fuzz_Test is Budgets_Shared_Test {
    function testFuzz_CommitsIffWithinLeft(uint128 first, uint128 second) external {
        _tree();
        first = uint128(bound(first, 0, OFFSITE_AMOUNT));
        _commit(offsite, first);
        uint128 left = OFFSITE_AMOUNT - first;
        vm.prank(agreements);
        if (second > left) {
            vm.expectRevert(abi.encodeWithSelector(IBudgets.OverBudget.selector, offsite, left, second));
            budgets.commit(offsite, second);
        } else {
            budgets.commit(offsite, second);
            assertEq(_budget(offsite).ownCommitted, first + second, "ownCommitted");
            assertEq(_budget(top).committed, first + second, "committed at the top (B2)");
        }
    }

    function testFuzz_OnlyAgreements(address caller) external {
        _tree();
        vm.assume(caller != agreements);
        vm.prank(caller);
        vm.expectRevert(IBudgets.OnlyAgreements.selector);
        budgets.commit(offsite, 1);
    }
}
