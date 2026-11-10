// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICaptable } from "../../../../../src/interfaces/ICaptable.sol";
import { Captable_Test } from "../../../../utils/Captable/Captable_Test.sol";

/// @dev E4 and ruling F8: only the company Governor or Rounds lowers a conversion price, never the Board alone.
contract SetConversionPrice_Captable_Unit_Concrete_Test is Captable_Test {
    modifier whenTheCallerIsNeitherTheCompanyGovernorNorRounds() {
        _;
    }

    function test_WhenTheCallerIsNeitherTheCompanyGovernorNorRounds()
        external
        whenTheCallerIsNeitherTheCompanyGovernorNorRounds
    {
        // it should revert with OnlyGovernor
        vm.prank(users.eve);
        vm.expectRevert(ICaptable.OnlyGovernor.selector);
        captable.setConversionPrice(SERIES_A, 1.5e6);

        vm.prank(options);
        vm.expectRevert(ICaptable.OnlyGovernor.selector);
        captable.setConversionPrice(SERIES_A, 1.5e6);
    }

    function test_GivenTheCallerIsTheSafe() external whenTheCallerIsNeitherTheCompanyGovernorNorRounds {
        // it should revert with OnlyGovernor
        vm.prank(address(safe));
        vm.expectRevert(ICaptable.OnlyGovernor.selector);
        captable.setConversionPrice(SERIES_A, 1.5e6);
    }

    function test_WhenTheClassDoesNotExist() external {
        // it should revert with UnknownClass
        vm.prank(address(governor));
        vm.expectRevert(abi.encodeWithSelector(ICaptable.UnknownClass.selector, uint8(2)));
        captable.setConversionPrice(2, 1.5e6);
    }

    function test_WhenTheClassHasNoIssuePrice() external {
        // it should revert with NotConvertible
        vm.prank(address(governor));
        vm.expectRevert(abi.encodeWithSelector(ICaptable.NotConvertible.selector, COMMON));
        captable.setConversionPrice(COMMON, 1);
    }

    function test_WhenTheNewPriceIsNotLowerThanTheCurrentOne() external {
        // it should revert with ConversionPriceNotLower
        vm.prank(address(governor));
        vm.expectRevert(abi.encodeWithSelector(ICaptable.ConversionPriceNotLower.selector, SERIES_A_OIP, SERIES_A_OIP));
        captable.setConversionPrice(SERIES_A, SERIES_A_OIP);

        _lowerPrice(SERIES_A, 1.5e6);
        vm.prank(rounds);
        vm.expectRevert(abi.encodeWithSelector(ICaptable.ConversionPriceNotLower.selector, 1.5e6, 1.6e6));
        captable.setConversionPrice(SERIES_A, 1.6e6);
    }

    function test_WhenTheNewPriceIsBelowTheClassFloor() external {
        // it should revert with BelowFloor
        vm.prank(address(governor));
        vm.expectRevert(abi.encodeWithSelector(ICaptable.BelowFloor.selector, SERIES_A_FLOOR, SERIES_A_FLOOR - 1));
        captable.setConversionPrice(SERIES_A, SERIES_A_FLOOR - 1);
    }

    function test_WhenTheNewPriceIsLowerAndAtOrAboveTheFloor() external {
        _issue(SERIES_A, users.investor, 100);
        _warp(1 days);
        uint256 before = vm.getBlockTimestamp() - 1;
        assertEq(captable.getVotes(users.investor), 100, "100 shares at ratio 1");

        // it should emit ConversionPriceSet
        vm.expectEmit(address(captable));
        emit ICaptable.ConversionPriceSet(SERIES_A, 1e6);
        vm.prank(rounds);
        captable.setConversionPrice(SERIES_A, SERIES_A_FLOOR);

        // it should checkpoint the new price at this timestamp
        assertEq(captable.conversionPriceAt(SERIES_A, vm.getBlockTimestamp()), SERIES_A_FLOOR, "new price now");
        assertEq(captable.conversionPriceAt(SERIES_A, before), SERIES_A_OIP, "old price before");

        // it should raise the class's votes as converted from now on
        assertEq(captable.getVotes(users.investor), 200, "100 shares at ratio 2");

        // it should leave past votes unchanged
        _warp(1);
        assertEq(captable.getPastVotes(users.investor, before), 100, "past votes unchanged");
        assertEq(captable.getPastVotes(users.investor, vm.getBlockTimestamp() - 1), 200, "new votes checkpointed");
    }
}
