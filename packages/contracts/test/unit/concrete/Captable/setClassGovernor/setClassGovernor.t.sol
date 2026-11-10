// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICaptable } from "../../../../../src/interfaces/ICaptable.sol";
import { Captable_Test } from "../../../../utils/Captable/Captable_Test.sol";

contract SetClassGovernor_Captable_Unit_Concrete_Test is Captable_Test {
    function test_WhenTheCallerIsNotTheCompanyGovernor() external {
        // it should revert with OnlyGovernor
        vm.prank(address(safe));
        vm.expectRevert(ICaptable.OnlyGovernor.selector);
        captable.setClassGovernor(SERIES_A, address(classGovernor));

        vm.prank(users.eve);
        vm.expectRevert(ICaptable.OnlyGovernor.selector);
        captable.setClassGovernor(SERIES_A, address(classGovernor));
    }

    function test_WhenTheClassDoesNotExist() external {
        // it should revert with UnknownClass
        vm.prank(address(governor));
        vm.expectRevert(abi.encodeWithSelector(ICaptable.UnknownClass.selector, uint8(2)));
        captable.setClassGovernor(2, address(classGovernor));
    }

    function test_WhenTheClassAlreadyHasAClassGovernor() external {
        vm.prank(address(governor));
        captable.setClassGovernor(SERIES_A, address(classGovernor));

        // it should revert with InvalidClass
        vm.prank(address(governor));
        vm.expectPartialRevert(ICaptable.InvalidClass.selector);
        captable.setClassGovernor(SERIES_A, address(governor));
    }

    function test_WhenTheGovernorIsTheZeroAddress() external {
        // it should revert with InvalidClass
        vm.prank(address(governor));
        vm.expectPartialRevert(ICaptable.InvalidClass.selector);
        captable.setClassGovernor(SERIES_A, address(0));
    }

    function test_WhenTheClassHasNoClassGovernor() external {
        // it should emit ClassGovernorSet
        vm.expectEmit(address(captable));
        emit ICaptable.ClassGovernorSet(SERIES_A, address(classGovernor));
        vm.prank(address(governor));
        captable.setClassGovernor(SERIES_A, address(classGovernor));

        // it should store the class Governor
        assertEq(captable.getClass(SERIES_A).classGovernor, address(classGovernor), "stored");

        // it should make issuance in the class wait for that Governor's pending window
        uint48 until = uint48(vm.getBlockTimestamp() + 2 days);
        classGovernor.setPendingUntil(until);
        vm.prank(address(safe));
        vm.expectRevert(abi.encodeWithSelector(ICaptable.ProposalPending.selector, SERIES_A, until));
        captable.issue(SERIES_A, users.investor, 1, REASON);

        // Other classes are not held up by this class's Governor.
        _issue(COMMON, users.amira, 1);
        assertEq(_token(COMMON).balanceOf(users.amira), 1, "Common still issues");

        vm.warp(uint256(until) + 1);
        _issue(SERIES_A, users.investor, 1);
        assertEq(_token(SERIES_A).balanceOf(users.investor), 1, "issues after the window");
    }
}
