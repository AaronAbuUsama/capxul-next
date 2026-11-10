// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { stdError } from "forge-std/StdError.sol";

import { Calendar_Shared_Test } from "../../../../utils/Calendar/Calendar_Shared_Test.sol";
import { CalendarModel } from "../../../../utils/Calendar/CalendarModel.sol";

contract Earned_Calendar_Unit_Concrete_Test is Calendar_Shared_Test {
    uint256 internal constant RATE = 40_000e6;

    function test_WhenToIsAtOrBeforeFrom() external view {
        // it should return 0
        assertEq(calendar.earned(RATE, MONTH, START, START), 0, "to == from");
        assertEq(calendar.earned(RATE, YEAR, START + 1, START), 0, "to < from");
        assertEq(calendar.earned(RATE, WEEK, UNTIL, 0), 0, "to far before from");
    }

    modifier whenToIsAfterFrom() {
        _;
    }

    function test_WhenThePeriodIsMONTH() external view whenToIsAfterFrom {
        // it should return rate times 12 times the clock difference
        uint256 from = _date(2026, 1, 20) + 5 hours;
        uint256 to = _date(2026, 3, 3) + 17;
        uint256 got = calendar.earned(3000e6, MONTH, from, to);
        assertEq(got, 3000e6 * 12 * (calendar.clock(MONTH, to) - calendar.clock(MONTH, from)), "the formula");
        assertEq(got, CalendarModel.pay(3000e6, MONTH, from, to), "the independent model");
    }

    function test_WhenThePeriodIsWEEKOrYEAR() external view whenToIsAfterFrom {
        // it should return rate times the clock difference
        uint256 from = _date(2026, 1, 20) + 5 hours;
        uint256 to = _date(2026, 3, 3) + 17;
        uint256 week = calendar.earned(250e6, WEEK, from, to);
        assertEq(week, 250e6 * (calendar.clock(WEEK, to) - calendar.clock(WEEK, from)), "WEEK formula");
        assertEq(week, CalendarModel.pay(250e6, WEEK, from, to), "WEEK model");
        uint256 year = calendar.earned(RATE, YEAR, from, to);
        assertEq(year, RATE * (calendar.clock(YEAR, to) - calendar.clock(YEAR, from)), "YEAR formula");
        assertEq(year, CalendarModel.pay(RATE, YEAR, from, to), "YEAR model");
    }

    function test_WhenThePeriodIsNotWEEKOrMONTHOrYEAR() external whenToIsAfterFrom {
        // it should revert with InvalidPeriod
        _expectInvalidPeriod(3);
        calendar.earned(RATE, 3, START, START + 1 days);
        // The check runs first: an unknown period reverts even when to <= from (spec/calendar.md).
        _expectInvalidPeriod(type(uint8).max);
        calendar.earned(RATE, type(uint8).max, START, START);
    }

    function test_GivenFromAndToSpanExactlyOneWholeCalendarMonth() external view whenToIsAfterFrom {
        // it should return one month's amount times SCALE whatever the month's length
        uint256[4] memory months = [_date(2027, 1, 1), _date(2027, 2, 1), _date(2028, 2, 1), _date(2027, 4, 1)];
        for (uint256 i; i < months.length; ++i) {
            uint256 next = CalendarModel.nextMonthStart(months[i]);
            assertEq(calendar.earned(3000e6, MONTH, months[i], next), 3000e6 * SCALE, "a monthly rate");
            assertEq(calendar.earned(RATE, YEAR, months[i], next), RATE * MONTH_UNITS, "a twelfth of a yearly rate");
        }
    }

    function test_GivenFromAndToSpanExactlyTwelveWholeCalendarMonths() external view whenToIsAfterFrom {
        // it should return a yearly rate times SCALE exactly
        uint256 from = _date(2027, 3, 1); // over 29 February 2028
        uint256 to = _date(2028, 3, 1);
        assertEq(calendar.earned(RATE, YEAR, from, to), RATE * SCALE, "a yearly rate");
        assertEq(calendar.earned(3000e6, MONTH, from, to), 12 * 3000e6 * SCALE, "twelve monthly amounts");
        assertEq(calendar.earned(7, YEAR, _date(2027, 1, 1), _date(2028, 1, 1)), 7 * SCALE, "a common year");
    }

    function test_WhenTheProductOverflows() external whenToIsAfterFrom {
        // it should revert with the checked arithmetic panic
        vm.expectRevert(stdError.arithmeticError);
        calendar.earned(type(uint256).max, WEEK, START, START + 1);
        vm.expectRevert(stdError.arithmeticError);
        calendar.earned(type(uint256).max / 11, MONTH, START, START + 1);
    }
}
