// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { stdError } from "forge-std/StdError.sol";

import { IBudgets } from "../../../../../src/interfaces/IBudgets.sol";

import { Budgets_Shared_Test } from "../../../../utils/Budgets/Budgets_Shared_Test.sol";

/// @notice spec/budgets.md `release` (Agreements only; B2, B15).
contract Release_Budgets_Unit_Concrete_Test is Budgets_Shared_Test {
    uint128 internal constant RESERVED = 8000e6;

    function test_WhenACallIntoBudgetsIsAlreadyRunning() external {
        // it should revert with ReentrantCall
        _assertLockRefuses(abi.encodeCall(IBudgets.release, (1, 1)));
    }

    function test_WhenTheCallerIsNotTheAgreementsContract() external {
        _tree();
        _commit(offsite, RESERVED);
        // it should revert with OnlyAgreements
        address[3] memory callers = [users.eve, address(safe), users.jordan];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(IBudgets.OnlyAgreements.selector);
            budgets.release(offsite, 1);
        }
    }

    modifier whenTheCallerIsTheAgreementsContract() {
        _tree();
        _commit(offsite, RESERVED);
        _;
    }

    function test_WhenTheAmountIsMoreThanOwnCommitted() external whenTheCallerIsTheAgreementsContract {
        // Operations' total committed includes Offsite's, but its own is 0.
        assertEq(_budget(operations).committed, RESERVED, "Operations counts Offsite's reservation");
        // it should revert with the checked arithmetic panic
        vm.prank(agreements);
        vm.expectRevert(stdError.arithmeticError);
        budgets.release(offsite, RESERVED + 1);

        vm.prank(agreements);
        vm.expectRevert(stdError.arithmeticError);
        budgets.release(operations, 1);
    }

    modifier whenTheAmountIsAtMostOwnCommitted() {
        _;
    }

    function test_WhenTheAmountIsAtMostOwnCommitted()
        external
        whenTheCallerIsTheAgreementsContract
        whenTheAmountIsAtMostOwnCommitted
    {
        uint128 amount = 3000e6;
        // it should emit Released
        vm.expectEmit(true, true, true, true, address(budgets));
        emit IBudgets.Released(address(safe), offsite, amount);
        vm.prank(agreements);
        budgets.release(offsite, amount);

        // it should subtract the amount from ownCommitted
        assertEq(_budget(offsite).ownCommitted, RESERVED - amount, "ownCommitted");
        // it should subtract the amount from committed on the budget and every budget above it
        uint256[4] memory path = [offsite, operations, operating, top];
        for (uint256 i; i < 4; ++i) {
            assertEq(_budget(path[i]).committed, RESERVED - amount, "committed up the tree");
        }
        assertEq(budgets.leftOf(offsite), OFFSITE_AMOUNT - RESERVED + amount, "the room is back");

        // The rest releases to exactly 0.
        vm.prank(agreements);
        budgets.release(offsite, RESERVED - amount);
        assertEq(_budget(top).committed, 0, "all released");
    }

    function test_GivenTheBudgetIsClosed()
        external
        whenTheCallerIsTheAgreementsContract
        whenTheAmountIsAtMostOwnCommitted
    {
        _close(address(safe), operating);
        _close(users.jordan, offsite);
        // it should still release
        vm.prank(agreements);
        budgets.release(offsite, RESERVED);
        assertEq(_budget(offsite).ownCommitted, 0, "released while closed");
    }
}
