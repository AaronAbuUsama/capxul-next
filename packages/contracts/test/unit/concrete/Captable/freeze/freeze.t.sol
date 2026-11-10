// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICaptable } from "../../../../../src/interfaces/ICaptable.sol";
import { Captable_Test } from "../../../../utils/Captable/Captable_Test.sol";

contract Freeze_Captable_Unit_Concrete_Test is Captable_Test {
    function test_WhenTheCallerIsNotTheCompanyGovernor() external {
        // it should revert with OnlyGovernor
        vm.prank(address(safe));
        vm.expectRevert(ICaptable.OnlyGovernor.selector);
        captable.freeze(COMMON);

        vm.prank(users.eve);
        vm.expectRevert(ICaptable.OnlyGovernor.selector);
        captable.freeze(COMMON);
    }

    function test_WhenTheClassDoesNotExist() external {
        // it should revert with UnknownClass
        vm.prank(address(governor));
        vm.expectRevert(abi.encodeWithSelector(ICaptable.UnknownClass.selector, uint8(2)));
        captable.freeze(2);
    }

    function test_WhenTheClassIsAlreadyFrozen() external {
        _freeze(COMMON);

        // it should revert with FrozenClass
        vm.prank(address(governor));
        vm.expectRevert(abi.encodeWithSelector(ICaptable.FrozenClass.selector, COMMON));
        captable.freeze(COMMON);
    }

    function test_WhenTheClassIsNotFrozen() external {
        _issue(SERIES_A, users.investor, 100);

        // it should emit ClassFrozen
        vm.expectEmit(address(captable));
        emit ICaptable.ClassFrozen(SERIES_A);
        _freeze(SERIES_A);

        // it should freeze the class forever
        assertTrue(captable.getClass(SERIES_A).frozen, "frozen");
        vm.prank(address(governor));
        vm.expectRevert(abi.encodeWithSelector(ICaptable.FrozenClass.selector, SERIES_A));
        captable.setAuthorised(SERIES_A, 2_000_000);

        // it should still allow issuance within authorised
        _issue(SERIES_A, users.investor, 50);
        assertEq(_token(SERIES_A).balanceOf(users.investor), 150, "still issues");

        // it should still allow holders to convert
        vm.prank(users.investor);
        captable.convert(SERIES_A, 10);
        assertEq(_token(SERIES_A).balanceOf(users.investor), 140, "converted out of the frozen class");
        assertEq(_token(COMMON).balanceOf(users.investor), 10, "converted into Common");
        assertTrue(captable.getClass(SERIES_A).frozen, "still frozen");
    }
}
