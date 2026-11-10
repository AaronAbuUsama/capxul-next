// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { BetaPayrollCalendar as PayrollCalendar } from "../../../utils/Calendar/BetaPayrollCalendar.sol";
import { Calendar } from "../../../../src/libraries/Calendar.sol";
import { Test } from "forge-std/Test.sol";

/// @notice Differential fuzz: every function v4 `Calendar` shares with beta `PayrollCalendar` (a verbatim copy in test/utils/Calendar/BetaPayrollCalendar.sol) must agree with
/// it on every input where v4 keeps beta's behaviour (spec/calendar.md "Source of behaviour"). v4 differs in
/// two places only, both excluded here: an unknown period reverts (beta falls through to the month clock), and
/// `daysOf` before 1970 reverts `DateBeforeEpoch()` (beta panics 0x11). Both are covered by their own trees.
contract Differential_Calendar_Unit_Fuzz_Test is Test {
    function testFuzz_Differential_Clock(uint8 period, uint128 t) external pure {
        period = uint8(bound(period, 0, 2));
        assertEq(Calendar.clock(period, t), PayrollCalendar.clock(period, t));
    }

    function testFuzz_Differential_Numerator(uint256 rate, uint8 period) external pure {
        period = uint8(bound(period, 0, 2));
        rate = bound(rate, 0, type(uint256).max / 12);
        assertEq(Calendar.numerator(rate, period), PayrollCalendar.numerator(rate, period));
    }

    function testFuzz_Differential_Earned(uint128 rate, uint8 period, uint64 from, uint64 to) external pure {
        period = uint8(bound(period, 0, 2));
        assertEq(Calendar.earned(rate, period, from, to), PayrollCalendar.earned(rate, period, from, to));
    }

    function testFuzz_Differential_Yearly(uint256 rate, uint8 period) external pure {
        period = uint8(bound(period, 0, 2));
        rate = bound(rate, 0, type(uint256).max / 53);
        assertEq(Calendar.yearly(rate, period), PayrollCalendar.yearly(rate, period));
    }

    function testFuzz_Differential_Months(uint128 t) external pure {
        (uint256 index, uint256 start, uint256 length) = Calendar.monthOf(t);
        (uint256 bIndex, uint256 bStart, uint256 bLength) = PayrollCalendar.monthOf(t);
        assertEq(index, bIndex, "index");
        assertEq(start, bStart, "start");
        assertEq(length, bLength, "length");
        assertEq(Calendar.monthStart(t), PayrollCalendar.monthStart(t), "monthStart");
        assertEq(Calendar.nextMonthStart(t), PayrollCalendar.nextMonthStart(t), "nextMonthStart");
    }

    function testFuzz_Differential_Dates(uint128 days_) external pure {
        (uint256 y, uint256 m, uint256 d) = Calendar.dateOf(days_);
        (uint256 by, uint256 bm, uint256 bd) = PayrollCalendar.dateOf(days_);
        assertEq(y, by, "year");
        assertEq(m, bm, "month");
        assertEq(d, bd, "day");
    }

    /// @dev Any year from 1970 and any month 1 to 12 and day 1 to 31 (even a day the month lacks: both
    /// compute the same overflow into the next month).
    function testFuzz_Differential_DaysOf(uint32 year, uint8 month, uint8 day) external pure {
        year = uint32(bound(year, 1970, type(uint32).max));
        month = uint8(bound(month, 1, 12));
        day = uint8(bound(day, 1, 31));
        assertEq(Calendar.daysOf(year, month, day), PayrollCalendar.daysOf(year, month, day));
    }

    /// @dev Any year and any month, 0 and 13 and above included: both are total functions over `uint256`.
    /// Half the runs (an even fuzzed month) are folded into 0 to 13 so the real months are hit often.
    function testFuzz_Differential_DaysInMonthAndLeap(uint256 year, uint256 month) external pure {
        if (month % 2 == 0) month = bound(month, 0, 13);
        assertEq(Calendar.daysInMonth(year, month), PayrollCalendar.daysInMonth(year, month), "daysInMonth");
        assertEq(Calendar.isLeapYear(year), PayrollCalendar.isLeapYear(year), "isLeapYear");
    }
}
