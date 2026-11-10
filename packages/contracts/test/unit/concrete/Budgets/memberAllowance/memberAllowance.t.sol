// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IBudgets } from "../../../../../src/interfaces/IBudgets.sol";

import { Budgets_Shared_Test } from "../../../../utils/Budgets/Budgets_Shared_Test.sol";

/// @notice decisions.md J1: a member's spending allowance is a one-person budget under a hat that member
/// wears. Budgets already does this; there is no second mechanism (so no tree, only this scenario).
contract MemberAllowance_Budgets_Unit_Concrete_Test is Budgets_Shared_Test {
    function test_AMemberAllowanceIsAOneChildBudgetUnderTheMembersHat() external {
        _treeWithSibling(YEAR);
        // Amira (CEO) gives Ben's spare hat a 1,000 allowance under Operating.
        hats.setWearer(SPARE_HAT, users.bob, true);
        uint256 allowance = _createChild(users.amira, operating, 1000e6, SPARE_HAT);

        // The member spends within it and the spend counts up the tree.
        _spend(users.bob, allowance, 400e6);
        assertEq(_budget(allowance).ownSpent, 400e6, "own spend");
        assertEq(_budget(operating).spent, 400e6, "counted in Operating");
        assertEq(_budget(top).spent, 400e6, "counted at the top");

        // Never over the allowance.
        vm.prank(users.bob);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.OverBudget.selector, allowance, 600e6, 600e6 + 1));
        budgets.spend(allowance, users.alice, 600e6 + 1, 0, DOC, keccak256("over"));

        // The hat gives no reach beyond the allowance: not the parent, not a sibling.
        vm.prank(users.bob);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotAuthorised.selector, operating, users.bob));
        budgets.spend(operating, users.alice, 1, 0, DOC, keccak256("up"));
        vm.prank(users.bob);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotAuthorised.selector, marketing, users.bob));
        budgets.spend(marketing, users.alice, 1, 0, DOC, keccak256("side"));

        // No self-raise through the member's own hat.
        vm.prank(users.bob);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotAuthorised.selector, allowance, users.bob));
        budgets.setAmount(allowance, 5000e6);

        // Losing the hat ends the allowance at once; the CEO can still raise it.
        hats.setWearer(SPARE_HAT, users.bob, false);
        vm.prank(users.bob);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotAuthorised.selector, allowance, users.bob));
        budgets.spend(allowance, users.alice, 1, 0, DOC, keccak256("lost"));
        vm.prank(users.amira);
        budgets.setAmount(allowance, 2000e6);
        assertEq(_budget(allowance).amount, 2000e6, "raised by the parent's authority");
    }
}
