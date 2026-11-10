// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICaptable } from "../../../../../src/interfaces/ICaptable.sol";
import { Captable_Test } from "../../../../utils/Captable/Captable_Test.sol";

contract SetIssuerAllowance_Captable_Unit_Concrete_Test is Captable_Test {
    function test_WhenTheCallerIsNotTheSafe() external {
        // it should revert with OnlyBoard
        vm.prank(address(governor));
        vm.expectRevert(ICaptable.OnlyBoard.selector);
        captable.setIssuerAllowance(options, COMMON, 1000);

        vm.prank(users.eve);
        vm.expectRevert(ICaptable.OnlyBoard.selector);
        captable.setIssuerAllowance(options, COMMON, 1000);
    }

    function test_WhenTheModuleIsNotOptionsOrRoundsOrVesting() external {
        // it should revert with OnlyModule
        vm.prank(address(safe));
        vm.expectRevert(ICaptable.OnlyModule.selector);
        captable.setIssuerAllowance(users.eve, COMMON, 1000);

        vm.prank(address(safe));
        vm.expectRevert(ICaptable.OnlyModule.selector);
        captable.setIssuerAllowance(exits, COMMON, 1000);

        // The module is checked before the class.
        vm.prank(address(safe));
        vm.expectRevert(ICaptable.OnlyModule.selector);
        captable.setIssuerAllowance(users.eve, 2, 1000);
    }

    function test_WhenTheClassDoesNotExist() external {
        // it should revert with UnknownClass
        vm.prank(address(safe));
        vm.expectRevert(abi.encodeWithSelector(ICaptable.UnknownClass.selector, uint8(2)));
        captable.setIssuerAllowance(options, 2, 1000);
    }

    function test_WhenTheSafeSetsAnAllowanceForAKnownModule() external {
        // it should emit IssuerAllowanceSet
        vm.expectEmit(address(captable));
        emit ICaptable.IssuerAllowanceSet(options, COMMON, 1_000_000);
        vm.prank(address(safe));
        captable.setIssuerAllowance(options, COMMON, 1_000_000);

        // it should replace the allowance
        assertEq(captable.issuerAllowance(options, COMMON), 1_000_000, "set");
        vm.prank(address(safe));
        captable.setIssuerAllowance(options, COMMON, 400);
        assertEq(captable.issuerAllowance(options, COMMON), 400, "replaced, not added");

        vm.prank(address(safe));
        captable.setIssuerAllowance(address(vesting), SERIES_A, 7);
        vm.prank(address(safe));
        captable.setIssuerAllowance(rounds, SERIES_A, 9);
        assertEq(captable.issuerAllowance(address(vesting), SERIES_A), 7, "vesting");
        assertEq(captable.issuerAllowance(rounds, SERIES_A), 9, "rounds");
        assertEq(captable.issuerAllowance(options, SERIES_A), 0, "per class");
    }
}
