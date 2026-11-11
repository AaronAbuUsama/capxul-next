// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICalendar } from "../../../../src/interfaces/ICalendar.sol";
import { Calendar_Shared_Test } from "../../../utils/Calendar/Calendar_Shared_Test.sol";
import { CalendarModel } from "../../../utils/Calendar/CalendarModel.sol";

contract Dates_Calendar_Unit_Fuzz_Test is Calendar_Shared_Test {
    /// @dev 9999-12-31, the last day of C3's domain.
    uint256 internal constant LAST_DAY = 2_932_896;

    /// @dev Ported from beta PayrollCalendar.t.sol:175-182, widened from 2200 to 9999.
    function testFuzz_Dates_RoundTrip(uint256 days_) external view {
        days_ = bound(days_, 0, LAST_DAY);
        (uint256 year, uint256 month, uint256 day) = calendar.dateOf(days_);
        assertGe(day, 1, "day from 1");
        assertLe(day, CalendarModel.daysIn(year, month), "day within its month");
        assertEq(calendar.daysOf(year, month, day), days_, "round trip");
    }

    function testFuzz_Dates_DaysOfMatchesTheModel(uint256 year, uint256 month, uint256 day) external view {
        year = bound(year, 1970, 2400);
        month = bound(month, 1, 12);
        day = bound(day, 1, CalendarModel.daysIn(year, month));
        assertEq(calendar.daysOf(year, month, day), CalendarModel.epochDays(year, month, day));
        assertEq(calendar.daysInMonth(year, month), CalendarModel.daysIn(year, month), "daysInMonth");
    }

    function testFuzz_Dates_IsLeapYear(uint256 year) external view {
        assertEq(calendar.isLeapYear(year), CalendarModel.isLeap(year));
    }

    function testFuzz_Dates_RevertWhen_BeforeEpoch(uint256 year, uint256 month, uint256 day) external {
        year = bound(year, 0, 1969);
        month = bound(month, 1, 12);
        day = bound(day, 1, 28);
        vm.expectRevert(ICalendar.DateBeforeEpoch.selector);
        calendar.daysOf(year, month, day);
    }
}
