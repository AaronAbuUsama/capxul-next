// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IHats } from "../../../../../src/interfaces/external/IHats.sol";

import { Budgets_Shared_Test } from "../../../../utils/Budgets/Budgets_Shared_Test.sol";

/// @notice spec/budgets.md "Who may act": `authorised(id, who)` (invariant H1).
contract Authorised_Budgets_Unit_Concrete_Test is Budgets_Shared_Test {
    function test_WhenTheBudgetDoesNotExist() external {
        _tree();
        // it should return false
        assertFalse(budgets.authorised(999, address(safe)), "the Safe on an unknown id");
        assertFalse(budgets.authorised(999, address(0)), "the zero address matches no stored Safe");
        assertFalse(budgets.authorised(0, address(0)), "id 0 is never a budget");
    }

    function test_WhenWhoIsTheBudgetsSafe() external {
        _tree();
        // The Safe needs no hat: it is the Board.
        hats.setWearer(BOARD_HAT, address(safe), false);
        // it should return true
        assertTrue(budgets.authorised(top, address(safe)), "top");
        assertTrue(budgets.authorised(offsite, address(safe)), "deepest");
    }

    function test_WhenWhoWearsTheBudgetsHatInGoodStanding() external {
        _tree();
        // it should return true
        assertTrue(budgets.authorised(operations, users.jordan), "Jordan wears Ops");
        assertTrue(budgets.authorised(operating, users.amira), "Amira wears CEO");
    }

    function test_WhenWhoWearsTheHatOfABudgetAboveItInGoodStanding() external {
        _tree();
        // it should return true
        assertTrue(budgets.authorised(operations, users.amira), "one level above");
        assertTrue(budgets.authorised(offsite, users.amira), "two levels above");
    }

    function test_WhenWhoWearsTheHatButIsNotInGoodStanding() external {
        _tree();
        // Hats reports Jordan as wearer, but not in good standing: Budgets must ask both.
        vm.mockCall(address(hats), abi.encodeCall(IHats.isWearerOfHat, (users.jordan, OPS_HAT)), abi.encode(true));
        hats.setStanding(OPS_HAT, users.jordan, false);
        // it should return false
        assertFalse(budgets.authorised(operations, users.jordan), "bad standing");
        assertFalse(budgets.authorised(offsite, users.jordan), "bad standing below");
    }

    function test_WhenTheHatIsInactiveOrItsWearerIsIneligible() external {
        _tree();
        assertTrue(budgets.authorised(operations, users.jordan), "before");
        // An inactive hat or an ineligible wearer: Hats' isWearerOfHat turns false; nothing is cached (H6).
        hats.setWearer(OPS_HAT, users.jordan, false);
        // it should return false
        assertFalse(budgets.authorised(operations, users.jordan), "after");
        assertFalse(budgets.authorised(offsite, users.jordan), "after, below");
    }

    function test_WhenWhoWearsOnlyTheHatOfABudgetBelowIt() external {
        _tree();
        // it should return false
        assertFalse(budgets.authorised(operating, users.jordan), "Ops does not reach Operating");
        assertFalse(budgets.authorised(top, users.amira), "CEO does not reach the top");
    }

    function test_WhenWhoWearsOnlyTheHatOfASiblingBudget() external {
        _treeWithSibling(YEAR);
        // it should return false
        assertFalse(budgets.authorised(operations, users.ben), "Marketing does not reach Operations");
        assertFalse(budgets.authorised(marketing, users.jordan), "Operations does not reach Marketing");
    }

    function test_WhenWhoWearsOnlyADirectorHat() external {
        _tree();
        hats.setWearer(DIRECTOR_HAT, users.alice, true);
        // it should return false
        assertFalse(budgets.authorised(top, users.alice), "a Director is not the Board");
        assertFalse(budgets.authorised(offsite, users.alice), "nor any budget under it");
    }

    function test_WhenWhoWearsNoHatOnTheBudgetsPath() external {
        _tree();
        // it should return false
        assertFalse(budgets.authorised(top, users.eve), "top");
        assertFalse(budgets.authorised(operations, users.eve), "operations");
        assertFalse(budgets.authorised(offsite, users.eve), "offsite");
    }
}
