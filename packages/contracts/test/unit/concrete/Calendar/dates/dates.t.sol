// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICalendar } from "../../../../../src/interfaces/ICalendar.sol";
import { Calendar_Shared_Test } from "../../../../utils/Calendar/Calendar_Shared_Test.sol";
import { CalendarModel } from "../../../../utils/Calendar/CalendarModel.sol";

contract Dates_Calendar_Unit_Concrete_Test is Calendar_Shared_Test {
    function test_WhenDaysIs0() external view {
        // it should return 1970-01-01
        _assertDate(0, 1970, 1, 1);
        assertEq(calendar.daysOf(1970, 1, 1), 0, "daysOf");
        // 1970 is a common year: 1 January 1971 is day 365.
        assertFalse(calendar.isLeapYear(1970), "1970");
        _assertDate(364, 1970, 12, 31);
        assertEq(calendar.daysOf(1971, 1, 1), 365, "1971-01-01");
    }

    function test_WhenTheDateIs29FebruaryInALeapYear() external view {
        // it should round trip through daysOf and dateOf
        uint256 d = CalendarModel.epochDays(2028, 2, 29);
        assertEq(calendar.daysOf(2028, 2, 29), d, "daysOf");
        _assertDate(d, 2028, 2, 29);
        _assertDate(d + 1, 2028, 3, 1);
        assertTrue(calendar.isLeapYear(2028), "2028 is leap");
        assertEq(calendar.daysInMonth(2028, 2), 29, "29 days");
    }

    function test_WhenTheYearIsDivisibleBy100ButNotBy400() external view {
        // it should treat it as a common year
        assertFalse(calendar.isLeapYear(1900), "1900");
        assertEq(calendar.daysInMonth(1900, 2), 28, "28 days in February 1900");
        assertFalse(calendar.isLeapYear(2100), "2100");
        assertFalse(calendar.isLeapYear(2200), "2200");
        assertEq(calendar.daysInMonth(2100, 2), 28, "28 days");
        _assertDate(CalendarModel.epochDays(2100, 3, 1) - 1, 2100, 2, 28);
        assertEq(calendar.daysOf(2100, 3, 1) - calendar.daysOf(2100, 2, 28), 1, "no 29 February");
    }

    function test_WhenTheYearIsDivisibleBy400() external view {
        // it should treat it as a leap year
        assertTrue(calendar.isLeapYear(2000), "2000");
        assertTrue(calendar.isLeapYear(2400), "2400");
        assertEq(calendar.daysInMonth(2000, 2), 29, "29 days");
        _assertDate(CalendarModel.epochDays(2000, 2, 29), 2000, 2, 29);
        assertEq(calendar.daysOf(2400, 2, 29), CalendarModel.epochDays(2400, 2, 29), "2400-02-29");
    }

    modifier whenTheDateIsBefore1970() {
        _;
    }

    function test_GivenItIs31December1969() external whenTheDateIsBefore1970 {
        // it should revert with DateBeforeEpoch
        vm.expectRevert(ICalendar.DateBeforeEpoch.selector);
        calendar.daysOf(1969, 12, 31);
    }

    function test_GivenTheYearIs0InJanuaryOrFebruary() external whenTheDateIsBefore1970 {
        // it should revert with DateBeforeEpoch and not panic
        vm.expectRevert(ICalendar.DateBeforeEpoch.selector);
        calendar.daysOf(0, 1, 1);
        vm.expectRevert(ICalendar.DateBeforeEpoch.selector);
        calendar.daysOf(0, 2, 29);
    }

    /// @dev Every day from 1970 to 2069 (inside the 2**30 test gas limit) against a date walked one day at a time; C3's full range to 9999 is
    /// the exhaustive loop (test/exhaustive/Calendar.exhaustive.t.sol).
    function test_ShouldRoundTripDaysOfOfDateOfForEveryDay() external view {
        // it should round trip daysOf of dateOf for every day
        (uint256 y, uint256 m, uint256 d) = (1970, 1, 1);
        uint256 end = CalendarModel.epochDays(2070, 1, 1);
        for (uint256 days_; days_ < end; ++days_) {
            (uint256 year, uint256 month, uint256 day) = calendar.dateOf(days_);
            if (year != y || month != m || day != d) assertTrue(false, "dateOf matches the walk");
            if (calendar.daysOf(year, month, day) != days_) assertEq(calendar.daysOf(year, month, day), days_);
            if (d < CalendarModel.daysIn(y, m)) {
                ++d;
            } else {
                (y, m, d) = m == 12 ? (y + 1, 1, 1) : (y, m + 1, 1);
            }
        }
        // The far edge of the domain: 9999-12-31 is day 2,932,896 and 9999 is a common year.
        assertFalse(calendar.isLeapYear(9999), "9999");
        assertEq(calendar.daysOf(9999, 12, 31), 2_932_896, "9999-12-31");
        _assertDate(2_932_896, 9999, 12, 31);
    }

    function _assertDate(uint256 days_, uint256 year, uint256 month, uint256 day) internal view {
        (uint256 y, uint256 m, uint256 d) = calendar.dateOf(days_);
        assertEq(y, year, "year");
        assertEq(m, month, "month");
        assertEq(d, day, "day");
    }
}
