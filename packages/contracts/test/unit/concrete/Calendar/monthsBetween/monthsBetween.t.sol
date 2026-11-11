// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Calendar_Shared_Test } from "../../../../utils/Calendar/Calendar_Shared_Test.sol";
import { CalendarModel } from "../../../../utils/Calendar/CalendarModel.sol";

contract MonthsBetween_Calendar_Unit_Concrete_Test is Calendar_Shared_Test {
    function test_WhenToIsAtOrBeforeFrom() external view {
        // it should return 0
        assertEq(calendar.monthsBetween(START, START), 0, "to == from");
        assertEq(calendar.monthsBetween(START + 400 days, START), 0, "to < from");
    }

    modifier whenToIsAfterFrom() {
        _;
    }

    /// @dev From 31 January 2026 at 10:00, `to` walks forward 26 months in steps of a day and 3,607 seconds:
    /// the count never falls and always equals the model's step-by-step count.
    function test_WhenToIsAfterFrom() external view whenToIsAfterFrom {
        // it should never decrease as to moves forward
        uint256 from = _date(2026, 1, 31) + 10 hours;
        uint256 last;
        for (uint256 to = from; to < from + 800 days; to += 1 days + 3607) {
            uint256 m = calendar.monthsBetween(from, to);
            assertGe(m, last, "never decreases");
            assertEq(m, CalendarModel.monthsBetween(from, to), "the model");
            last = m;
        }
        assertEq(last, 26, "26 whole months");
    }

    function test_GivenToIsOneSecondBeforeTheSameDayOfTheNextMonth() external view whenToIsAfterFrom {
        // it should return 0
        uint256 from = _date(2026, 3, 15) + 9 hours + 30 minutes;
        assertEq(calendar.monthsBetween(from, _date(2026, 4, 15) + 9 hours + 30 minutes - 1), 0);
    }

    function test_GivenToIsExactlyTheSameDayAndTimeOfALaterMonth() external view whenToIsAfterFrom {
        // it should count that month
        uint256 from = _date(2026, 3, 15) + 9 hours + 30 minutes;
        assertEq(calendar.monthsBetween(from, _date(2026, 4, 15) + 9 hours + 30 minutes), 1, "one month");
        assertEq(calendar.monthsBetween(from, _date(2026, 6, 15) + 9 hours + 30 minutes), 3, "three months");
        assertEq(calendar.monthsBetween(from, _date(2027, 3, 15) + 9 hours + 30 minutes), 12, "a year");
        // December to January crosses the year.
        assertEq(calendar.monthsBetween(_date(2026, 12, 10), _date(2027, 1, 10)), 1, "December to January");
    }

    function test_GivenFromIsOnThe31stAndALaterMonthIsShorter() external view whenToIsAfterFrom {
        // it should step on that month's last day
        uint256 from = _date(2026, 1, 31);
        assertEq(calendar.monthsBetween(from, _date(2026, 2, 28) - 1), 0, "before 28 February");
        assertEq(calendar.monthsBetween(from, _date(2026, 2, 28)), 1, "28 February");
        assertEq(calendar.monthsBetween(from, _date(2026, 3, 30)), 1, "the 31st again, not the 28th");
        assertEq(calendar.monthsBetween(from, _date(2026, 3, 31)), 2, "31 March");
        assertEq(calendar.monthsBetween(from, _date(2026, 4, 30)), 3, "30 April");
        assertEq(calendar.monthsBetween(_date(2027, 12, 31), _date(2028, 2, 29)), 2, "29 February of a leap year");
    }

    function test_GivenFromIs29FebruaryAndTheLaterYearIsNotALeapYear() external view whenToIsAfterFrom {
        // it should step on 28 February
        uint256 from = _date(2028, 2, 29) + 8 hours;
        assertEq(calendar.monthsBetween(from, _date(2029, 2, 28) + 8 hours - 1), 11, "one second short");
        assertEq(calendar.monthsBetween(from, _date(2029, 2, 28) + 8 hours), 12, "28 February 2029");
        assertEq(calendar.monthsBetween(from, _date(2029, 3, 29) + 8 hours), 13, "back on the 29th");
        assertEq(calendar.monthsBetween(from, _date(2032, 2, 29) + 8 hours), 48, "the next leap day");
    }
}
