// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICaptable } from "../../../../../src/interfaces/ICaptable.sol";
import { Captable_Test } from "../../../../utils/Captable/Captable_Test.sol";

contract SetTransferRule_Captable_Unit_Concrete_Test is Captable_Test {
    function test_WhenTheCallerIsNotTheCompanyGovernor() external {
        // it should revert with OnlyGovernor
        vm.prank(address(safe));
        vm.expectRevert(ICaptable.OnlyGovernor.selector);
        captable.setTransferRule(COMMON, ICaptable.TransferRule.AllowAll, address(0));

        vm.prank(users.eve);
        vm.expectRevert(ICaptable.OnlyGovernor.selector);
        captable.setTransferRule(COMMON, ICaptable.TransferRule.AllowAll, address(0));
    }

    function test_WhenTheClassDoesNotExist() external {
        // it should revert with UnknownClass
        vm.prank(address(governor));
        vm.expectRevert(abi.encodeWithSelector(ICaptable.UnknownClass.selector, uint8(2)));
        captable.setTransferRule(2, ICaptable.TransferRule.AllowAll, address(0));
    }

    function test_WhenTheClassIsFrozen() external {
        _freeze(SERIES_A);

        // it should revert with FrozenClass
        vm.prank(address(governor));
        vm.expectRevert(abi.encodeWithSelector(ICaptable.FrozenClass.selector, SERIES_A));
        captable.setTransferRule(SERIES_A, ICaptable.TransferRule.AllowAll, address(0));
    }

    function test_WhenTheRuleIsCustomAndTheRuleContractIsTheZeroAddress() external {
        // it should revert with InvalidClass
        vm.prank(address(governor));
        vm.expectPartialRevert(ICaptable.InvalidClass.selector);
        captable.setTransferRule(COMMON, ICaptable.TransferRule.Custom, address(0));
    }

    function test_WhenTheRuleIsValid() external {
        // it should emit TransferRuleSet
        vm.expectEmit(address(captable));
        emit ICaptable.TransferRuleSet(COMMON, ICaptable.TransferRule.Custom, address(rule));
        _setRule(COMMON, ICaptable.TransferRule.Custom, address(rule));

        // it should store the rule
        ICaptable.Class memory c = captable.getClass(COMMON);
        assertEq(uint8(c.rule), uint8(ICaptable.TransferRule.Custom), "rule stored");
        assertEq(c.customRule, address(rule), "rule contract stored");

        _setRule(COMMON, ICaptable.TransferRule.ToAnyShareholder, address(0));
        assertEq(uint8(captable.getClass(COMMON).rule), uint8(ICaptable.TransferRule.ToAnyShareholder), "replaced");
    }
}
