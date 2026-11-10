// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IBudgets } from "../../../../../src/interfaces/IBudgets.sol";

import { Budgets_Shared_Test } from "../../../../utils/Budgets/Budgets_Shared_Test.sol";

/// @notice spec/budgets.md "Shape": `setAgreements` is callable once, by the deployer (Companies House).
contract SetAgreements_Budgets_Unit_Concrete_Test is Budgets_Shared_Test {
    function test_WhenACallIntoBudgetsIsAlreadyRunning() external {
        // it should revert with ReentrantCall
        _assertLockRefuses(abi.encodeCall(IBudgets.setAgreements, (agreements)));
    }

    function test_WhenTheCallerIsNotTheDeployer() external {
        // it should revert with NotDeployer
        vm.prank(users.eve);
        vm.expectRevert(IBudgets.NotDeployer.selector);
        budgets.setAgreements(agreements);
        assertEq(budgets.agreements(), address(0), "still unset");
    }

    function test_WhenAgreementsIsAlreadySet() external {
        budgets.setAgreements(agreements);
        // it should revert with AlreadySet
        vm.expectRevert(IBudgets.AlreadySet.selector);
        budgets.setAgreements(makeAddr("another"));
        assertEq(budgets.agreements(), agreements, "unchanged");
    }

    function test_WhenTheAddressIsZero() external {
        // it should revert with ZeroAddress
        vm.expectRevert(IBudgets.ZeroAddress.selector);
        budgets.setAgreements(address(0));
    }

    function test_WhenTheDeployerSetsItOnce() external {
        // it should emit AgreementsSet
        vm.expectEmit(true, true, true, true, address(budgets));
        emit IBudgets.AgreementsSet(agreements);
        budgets.setAgreements(agreements);
        // it should store it
        assertEq(budgets.agreements(), agreements, "stored");
    }
}
