// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IBudgets } from "../../../../../src/interfaces/IBudgets.sol";
import { IHats } from "../../../../../src/interfaces/external/IHats.sol";

import { Budgets_Shared_Test } from "../../../../utils/Budgets/Budgets_Shared_Test.sol";

/// @notice spec/budgets.md `commit` (Agreements only; B1, B2, B3, B15).
contract Commit_Budgets_Unit_Concrete_Test is Budgets_Shared_Test {
    function test_WhenACallIntoBudgetsIsAlreadyRunning() external {
        // it should revert with ReentrantCall
        _assertLockRefuses(abi.encodeCall(IBudgets.commit, (1, 1)));
    }

    function test_WhenTheCallerIsNotTheAgreementsContract() external {
        _tree();
        // it should revert with OnlyAgreements
        address[3] memory callers = [users.eve, address(safe), users.jordan];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(IBudgets.OnlyAgreements.selector);
            budgets.commit(offsite, 1);
        }
    }

    modifier whenTheCallerIsTheAgreementsContract() {
        _tree();
        _;
    }

    function test_WhenTheBudgetDoesNotExist() external whenTheCallerIsTheAgreementsContract {
        // it should revert with UnknownBudget
        vm.prank(agreements);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.UnknownBudget.selector, uint256(999)));
        budgets.commit(999, 1);
    }

    function test_WhenTheBudgetOrAnyBudgetAboveItIsClosed() external whenTheCallerIsTheAgreementsContract {
        _close(address(safe), operating);
        // it should revert with BudgetIsClosed
        vm.prank(agreements);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.BudgetIsClosed.selector, operating));
        budgets.commit(offsite, 1);
    }

    function test_WhenTheAmountIsMoreThanIsLeftInTheBudget() external whenTheCallerIsTheAgreementsContract {
        _spend(users.jordan, offsite, 2000e6);
        uint128 left = OFFSITE_AMOUNT - 2000e6;
        // it should revert with OverBudget
        vm.prank(agreements);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.OverBudget.selector, offsite, left, left + 1));
        budgets.commit(offsite, left + 1);
    }

    function test_WhenTheAmountFits() external whenTheCallerIsTheAgreementsContract {
        uint128 amount = 5000e6;
        // Nobody on the path wears a hat any more: commit does not care.
        hats.setWearer(OPS_HAT, users.jordan, false);
        hats.setWearer(CEO_HAT, users.amira, false);

        // it should not check the hat
        vm.expectCall(address(hats), abi.encodeWithSelector(IHats.isWearerOfHat.selector), 0);
        vm.expectCall(address(hats), abi.encodeWithSelector(IHats.isInGoodStanding.selector), 0);
        // it should emit Committed
        vm.expectEmit(true, true, true, true, address(budgets));
        emit IBudgets.Committed(address(safe), offsite, amount);
        vm.prank(agreements);
        budgets.commit(offsite, amount);

        // it should add the amount to ownCommitted
        assertEq(_budget(offsite).ownCommitted, amount, "ownCommitted");
        assertEq(_budget(operations).ownCommitted, 0, "only Offsite's own");
        // it should add the amount to committed on the budget and every budget above it
        uint256[4] memory path = [offsite, operations, operating, top];
        for (uint256 i; i < 4; ++i) {
            assertEq(_budget(path[i]).committed, amount, "committed up the tree (B2)");
        }
        assertEq(budgets.leftOf(offsite), OFFSITE_AMOUNT - amount, "left");
    }
}
