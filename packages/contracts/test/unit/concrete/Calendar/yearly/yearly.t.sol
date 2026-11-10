// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Calendar_Shared_Test } from "../../../../utils/Calendar/Calendar_Shared_Test.sol";

/// @dev Values ported from beta `packages/contracts/test/unit/PayrollCalendar.t.sol:72-76`.
contract Yearly_Calendar_Unit_Concrete_Test is Calendar_Shared_Test {
    function test_WhenThePeriodIsWEEK() external view {
        // it should return rate times 53
        assertEq(calendar.yearly(250e6, WEEK), 13_250e6);
        assertEq(calendar.yearly(1, WEEK), 53);
    }

    function test_WhenThePeriodIsMONTH() external view {
        // it should return rate times 12
        assertEq(calendar.yearly(3000e6, MONTH), 36_000e6);
        assertEq(calendar.yearly(1, MONTH), 12);
    }

    function test_WhenThePeriodIsYEAR() external view {
        // it should return rate
        assertEq(calendar.yearly(40_000e6, YEAR), 40_000e6);
        assertEq(calendar.yearly(type(uint256).max, YEAR), type(uint256).max);
    }

    function test_WhenThePeriodIsAnythingElse() external {
        // it should revert with InvalidPeriod
        _expectInvalidPeriod(3);
        calendar.yearly(1, 3);
        _expectInvalidPeriod(type(uint8).max);
        calendar.yearly(1, type(uint8).max);
    }
}
