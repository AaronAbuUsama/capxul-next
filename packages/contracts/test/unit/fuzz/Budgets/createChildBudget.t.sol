// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IBudgets } from "../../../../src/interfaces/IBudgets.sol";

import { Budgets_Shared_Test } from "../../../utils/Budgets/Budgets_Shared_Test.sol";

/// @notice createChildBudget.tree's room leaves over every amount: a child fits exactly when its amount
/// is at most the parent's room (Q16, B6), with the parent's own spend and commitments counted.
contract CreateChildBudget_Budgets_Unit_Fuzz_Test is Budgets_Shared_Test {
    function testFuzz_ChildFitsIffWithinRoom(uint128 spent, uint128 committed, uint128 amount) external {
        _tree();
        uint128 room = OPERATIONS_AMOUNT - OFFSITE_AMOUNT;
        spent = uint128(bound(spent, 0, room));
        committed = uint128(bound(committed, 0, room - spent));
        if (spent > 0) _spend(users.jordan, operations, spent);
        if (committed > 0) _commit(operations, committed);
        uint128 left = room - spent - committed;

        vm.prank(users.jordan);
        if (amount > left) {
            vm.expectRevert(abi.encodeWithSelector(IBudgets.ChildrenExceedParent.selector, operations, left, amount));
            budgets.createChildBudget(operations, amount, SPARE_HAT);
        } else {
            uint256 id = budgets.createChildBudget(operations, amount, SPARE_HAT);
            assertEq(_budget(id).amount, amount, "amount");
            assertEq(_budget(operations).childrenAmount, OFFSITE_AMOUNT + amount, "childrenAmount (B6)");
            assertLe(_used(operations), OPERATIONS_AMOUNT, "B1 holds");
        }
    }

    function testFuzz_RefusesEveryoneOffThePath(address caller) external {
        _treeWithSibling(YEAR);
        vm.assume(caller != address(safe) && caller != users.amira && caller != users.jordan);
        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotAuthorised.selector, operations, caller));
        budgets.createChildBudget(operations, 1, SPARE_HAT);
    }
}
