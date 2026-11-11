// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Calendar_Shared_Test } from "../../../../utils/Calendar/Calendar_Shared_Test.sol";

contract Clock_Calendar_Unit_Concrete_Test is Calendar_Shared_Test {
    function test_WhenThePeriodIsWEEK() external view {
        // it should return t times WEEK_UNITS_PER_SECOND
        assertEq(calendar.clock(WEEK, 0), 0, "1970");
        assertEq(calendar.clock(WEEK, START), START * WEEK_UNITS_PER_SECOND, "2026");
        assertEq(calendar.clock(WEEK, UNTIL), UNTIL * WEEK_UNITS_PER_SECOND, "2200");
        assertEq(calendar.clock(WEEK, START + 7 days) - calendar.clock(WEEK, START), SCALE, "a week is SCALE");
    }

    modifier whenThePeriodIsMONTHOrYEAR() {
        _;
    }

    function test_WhenThePeriodIsMONTHOrYEAR() external view whenThePeriodIsMONTHOrYEAR {
        // it should return the month index times MONTH_UNITS plus the seconds into the month times LCM_DAYS divided
        // by the days in the month
        uint256 start = _date(2026, 3, 1);
        uint256 t = _date(2026, 3, 15) + 12 hours + 7;
        uint256 expected = _monthIndex(2026, 3) * MONTH_UNITS + (t - start) * (LCM_DAYS / 31);
        assertEq(calendar.clock(MONTH, t), expected, "MONTH");
        assertEq(calendar.clock(YEAR, t), expected, "YEAR runs the same clock");
        // April has 30 days.
        t = _date(2026, 4, 30) + 1 hours;
        assertEq(
            calendar.clock(YEAR, t), _monthIndex(2026, 4) * MONTH_UNITS + (t - _date(2026, 4, 1)) * (LCM_DAYS / 30)
        );
    }

    function test_GivenTIsTheFirstSecondOfAMonth() external view whenThePeriodIsMONTHOrYEAR {
        // it should return exactly the month index times MONTH_UNITS
        assertEq(calendar.clock(MONTH, _date(2026, 5, 1)), _monthIndex(2026, 5) * MONTH_UNITS, "May 2026");
        assertEq(calendar.clock(YEAR, _date(2027, 1, 1)), _monthIndex(2027, 1) * MONTH_UNITS, "January 2027");
        assertEq(calendar.clock(MONTH, 0), _monthIndex(1970, 1) * MONTH_UNITS, "the epoch");
    }

    function test_GivenTIsTheLastSecondOfAMonth() external view whenThePeriodIsMONTHOrYEAR {
        // it should return less than the next month index times MONTH_UNITS
        uint256 last = _date(2026, 6, 1) - 1;
        uint256 c = calendar.clock(MONTH, last);
        assertLt(c, _monthIndex(2026, 6) * MONTH_UNITS, "below the next month");
        assertEq(c, _monthIndex(2026, 5) * MONTH_UNITS + (31 * DAY - 1) * (LCM_DAYS / 31), "one second short");
        assertEq(calendar.clock(MONTH, last + 1) - c, LCM_DAYS / 31, "continuous across the month start");
    }

    function test_GivenTIsInFebruaryOfALeapYear() external view whenThePeriodIsMONTHOrYEAR {
        // it should count 29 days so the month still runs exactly MONTH_UNITS
        assertEq(
            calendar.clock(MONTH, _date(2028, 3, 1)) - calendar.clock(MONTH, _date(2028, 2, 1)),
            MONTH_UNITS,
            "February 2028 runs one month"
        );
        uint256 t = _date(2028, 2, 29) + 12 hours;
        assertEq(calendar.clock(YEAR, t + 1) - calendar.clock(YEAR, t), LCM_DAYS / 29, "a second is 1/29 day's units");
        assertEq(
            calendar.clock(MONTH, _date(2027, 3, 1)) - calendar.clock(MONTH, _date(2027, 2, 1)),
            MONTH_UNITS,
            "February 2027 (28 days) runs one month too"
        );
    }

    function test_WhenThePeriodIsNotWEEKOrMONTHOrYEAR() external {
        // it should revert with InvalidPeriod
        _expectInvalidPeriod(3);
        calendar.clock(3, START);
        _expectInvalidPeriod(type(uint8).max);
        calendar.clock(type(uint8).max, START);
    }
}
