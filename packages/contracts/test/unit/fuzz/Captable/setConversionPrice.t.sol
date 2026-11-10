// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICaptable } from "../../../../src/interfaces/ICaptable.sol";
import { Captable_Test } from "../../../utils/Captable/Captable_Test.sol";

/// @dev E4: a conversion price only ever falls, and never below the floor.
contract SetConversionPrice_Captable_Unit_Fuzz_Test is Captable_Test {
    function testFuzz_SetConversionPrice(uint128 first, uint128 second) external {
        _setAndCheck(first, SERIES_A_OIP);
        uint128 current = captable.conversionPriceAt(SERIES_A, vm.getBlockTimestamp());
        _warp(1);
        _setAndCheck(second, current);
    }

    function _setAndCheck(uint128 price, uint128 current) internal {
        vm.prank(address(governor));
        if (price >= current) {
            vm.expectRevert(abi.encodeWithSelector(ICaptable.ConversionPriceNotLower.selector, current, price));
            captable.setConversionPrice(SERIES_A, price);
        } else if (price < SERIES_A_FLOOR) {
            vm.expectRevert(abi.encodeWithSelector(ICaptable.BelowFloor.selector, SERIES_A_FLOOR, price));
            captable.setConversionPrice(SERIES_A, price);
        } else {
            captable.setConversionPrice(SERIES_A, price);
            assertEq(captable.conversionPriceAt(SERIES_A, vm.getBlockTimestamp()), price, "lowered");
        }
        uint128 now_ = captable.conversionPriceAt(SERIES_A, vm.getBlockTimestamp());
        assertLe(now_, current, "never rises");
        assertGe(now_, SERIES_A_FLOOR, "never below the floor");
    }
}
