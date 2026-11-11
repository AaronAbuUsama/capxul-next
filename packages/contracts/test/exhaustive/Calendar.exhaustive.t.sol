// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";

import { Calendar } from "../../src/libraries/Calendar.sol";
import { ICalendar } from "../../src/interfaces/ICalendar.sol";

/// @notice The exhaustive Calendar proofs (fv/halmos.md "Not in Halmos", R4 3.1): every day and every month
/// from 1970 to 9999, enumerated. Enumeration of a finite domain is a complete proof of C1/C2 (clock across
/// month starts), C3, C4, C5 (MONTH, YEAR), C6 and C9.
/// @dev One test per property, each walking the whole range in one call. The standalone CI job uses
/// `forge test --profile exhaustive --threads 4`; coverage does not run these long walks.
/// Locally, `CALENDAR_LAST_YEAR=2069` (any year from 1970) walks only 1970 to that year, with the same checks.
contract Calendar_Exhaustive_Test is Test {
    uint256 internal constant DAY = ICalendar.DAY;
    uint256 internal constant MONTH_UNITS = ICalendar.MONTH_UNITS;
    uint256 internal constant SCALE = ICalendar.SCALE;
    uint256 internal constant LCM_DAYS = ICalendar.LCM_DAYS;

    /// @dev The last year walked: 9999, or `CALENDAR_LAST_YEAR`.
    function _lastYear() internal view returns (uint256) {
        return vm.envOr("CALENDAR_LAST_YEAR", uint256(9999));
    }

    /// @notice A property failed; `at` is the day or month (offset from 1970-01) or the time it failed at.
    error Broken(uint256 at);

    // ------------------------------------------------------------------ days

    /// @dev Days 0 (1970-01-01) up to but not including 1 January of the year after the last one walked,
    /// counted by the Gregorian rule written in this test, never by the library under test (a wrong `daysOf`
    /// must not shrink the domain a property walks). To 9999 that is 2,932,897 days.
    function _days() internal view returns (uint256 count) {
        uint256 last = _lastYear();
        require(last >= 1970, "CALENDAR_LAST_YEAR is before 1970");
        for (uint256 year = 1970; year <= last; ++year) {
            count += _isLeap(year) ? 366 : 365;
        }
        if (last == 9999) assertEq(count, 2_932_897, "1970-01-01 to 9999-12-31");
    }

    /// @dev C3: `daysOf(dateOf(d)) == d`, and consecutive days walk the calendar one day at a time.
    function testExhaustive_C3_dateRoundTrip() external view {
        uint256 end = _days();
        (uint256 y, uint256 m, uint256 d) = Calendar.dateOf(0);
        assertTrue(y == 1970 && m == 1 && d == 1, "day 0 is 1970-01-01");
        for (uint256 days_; days_ < end; ++days_) {
            (uint256 year, uint256 month, uint256 day) = Calendar.dateOf(days_);
            if (year != y || month != m || day != d) revert Broken(days_);
            if (Calendar.daysOf(year, month, day) != days_) revert Broken(days_);
            if (d < _daysIn(y, m)) {
                ++d;
            } else {
                (y, m, d) = m == 12 ? (y + 1, 1, 1) : (y, m + 1, 1);
            }
        }
        assertTrue(y == _lastYear() + 1 && m == 1 && d == 1, "the domain ends on 31 December of the last year");
    }

    /// @dev C4: `monthStart(t) <= t < nextMonthStart(t)` at both ends of every day (they depend on `t` only
    /// through `t / DAY`), and every year walked has twelve months summing to 365 or 366 days.
    /// Also: the month's start and next start stay fixed until the start moves, and it moves only to the old
    /// next start, on that day (so `nextMonthStart` is exactly the next month's first second, not merely after
    /// `t`); and each month's length from `monthOf` is the Gregorian one written in this test.
    function testExhaustive_C4_monthBounds() external view {
        uint256 end = _days();
        uint256 prevStart;
        uint256 prevNext;
        for (uint256 days_; days_ < end; ++days_) {
            uint256 t0 = days_ * DAY;
            uint256 t1 = t0 + DAY - 1;
            uint256 start = Calendar.monthStart(t0);
            uint256 next = Calendar.nextMonthStart(t1);
            if (start > t0 || next <= t1) revert Broken(days_);
            if (Calendar.monthStart(t1) != start || Calendar.nextMonthStart(t0) != next) revert Broken(days_);
            if (days_ != 0) {
                if (start == prevStart) {
                    if (next != prevNext) revert Broken(days_);
                } else if (start != t0 || start != prevNext) {
                    revert Broken(days_);
                }
            }
            (prevStart, prevNext) = (start, next);
            (uint256 year, uint256 month, uint256 day) = Calendar.dateOf(days_);
            if (month == 1 && day == 1) {
                uint256 s = t0;
                for (uint256 i; i < 12; ++i) {
                    s = Calendar.nextMonthStart(s);
                }
                if (s - t0 != (_isLeap(year) ? 366 : 365) * DAY) revert Broken(days_);
                // The twelve lengths `monthOf` reports, each against the test's own table.
                s = t0;
                uint256 total;
                for (uint256 m = 1; m <= 12; ++m) {
                    (, uint256 monthStart_, uint256 length) = Calendar.monthOf(s);
                    if (monthStart_ != s || length != _daysIn(year, m) * DAY) revert Broken(days_);
                    total += length;
                    s += _daysIn(year, m) * DAY;
                }
                if (total != (_isLeap(year) ? 366 : 365) * DAY) revert Broken(days_);
            }
        }
    }

    /// @dev C9: for budget period `p` (one test per budget period), `periodIndex` is the same at both
    /// ends of every day, never falls and rises by at most one from one day to the next; `periodStart(p, t) <= t < nextPeriodStart(p, t)`; and
    /// start, next start and index stay fixed until the index changes, which happens exactly on a start.
    function _c9(uint8 p) internal view {
        uint256 end = _days();
        {
            uint256 prevIndex;
            uint256 prevStart;
            uint256 prevNext;
            for (uint256 days_; days_ < end; ++days_) {
                uint256 t0 = days_ * DAY;
                uint256 t1 = t0 + DAY - 1;
                uint256 index = Calendar.periodIndex(p, t0);
                uint256 start = Calendar.periodStart(p, t0);
                uint256 next = Calendar.nextPeriodStart(p, t0);
                if (Calendar.periodIndex(p, t1) != index) revert Broken(days_);
                if (Calendar.periodStart(p, t1) != start || Calendar.nextPeriodStart(p, t1) != next) {
                    revert Broken(days_);
                }
                if (start > t0 || next <= t1) revert Broken(days_);
                if (days_ != 0) {
                    if (index == prevIndex) {
                        if (start != prevStart || next != prevNext) revert Broken(days_);
                    } else if (index != prevIndex + 1 || start != t0 || start != prevNext) {
                        revert Broken(days_);
                    }
                }
                (prevIndex, prevStart, prevNext) = (index, start, next);
            }
        }
    }

    // ---------------------------------------------------------------- months

    /// @dev Months 1970-01 to December of the last year walked (96,360 to 9999).
    function _months() internal view returns (uint256) {
        uint256 last = _lastYear();
        require(last >= 1970, "CALENDAR_LAST_YEAR is before 1970");
        return (last - 1969) * 12;
    }

    /// @dev C1, C2: at every month start the clock is exactly `index * MONTH_UNITS`, one second earlier it is
    /// below it, and inside the month it runs `LCM_DAYS / days` units a second (affine), for MONTH and YEAR.
    function testExhaustive_C1_C2_monthBoundaries() external view {
        uint256 end = _months();
        uint256 start;
        uint256 index = 1970 * 12;
        for (uint256 i; i < end; ++i) {
            uint256 next = Calendar.nextMonthStart(start);
            uint256 perSecond = LCM_DAYS / ((next - start) / DAY);
            for (uint8 p = ICalendar.MONTH; p <= ICalendar.YEAR; ++p) {
                if (Calendar.clock(p, start) != index * MONTH_UNITS) revert Broken(i);
                if (Calendar.clock(p, start + 1) != index * MONTH_UNITS + perSecond) revert Broken(i);
                uint256 mid = start + (next - start) / 2 + 7;
                if (Calendar.clock(p, mid) != index * MONTH_UNITS + (mid - start) * perSecond) revert Broken(i);
                if (Calendar.clock(p, next - 1) >= (index + 1) * MONTH_UNITS) revert Broken(i);
                if (Calendar.clock(p, next - 1) != index * MONTH_UNITS + (next - 1 - start) * perSecond) {
                    revert Broken(i);
                }
                if (Calendar.clock(p, next) != (index + 1) * MONTH_UNITS) revert Broken(i);
            }
            start = next;
            ++index;
        }
    }

    /// @dev C5 for MONTH and YEAR rates: over every budget month, quarter and year the rate earns exactly
    /// `numerator * MONTH_UNITS * months`, which is at most `periodFigure * SCALE`.
    function testExhaustive_C5_monthYear() external view {
        uint256 end = _months();
        uint256 start;
        uint256[2] memory rates = [uint256(13), type(uint128).max];
        for (uint256 i; i < end; ++i) {
            uint256 next = Calendar.nextMonthStart(start);
            uint256 quarterEnd = i % 3 == 0 ? _monthsAfter(next, 2) : 0;
            uint256 yearEnd = i % 12 == 0 ? _monthsAfter(quarterEnd, 9) : 0;
            for (uint8 rp = ICalendar.MONTH; rp <= ICalendar.YEAR; ++rp) {
                for (uint256 r; r < 2; ++r) {
                    uint256 n = Calendar.numerator(rates[r], rp);
                    _c5Period(rates[r], rp, ICalendar.BUDGET_MONTH, start, next, n * MONTH_UNITS);
                    if (quarterEnd != 0) {
                        _c5Period(rates[r], rp, ICalendar.BUDGET_QUARTER, start, quarterEnd, n * MONTH_UNITS * 3);
                    }
                    if (yearEnd != 0) {
                        _c5Period(rates[r], rp, ICalendar.BUDGET_YEAR, start, yearEnd, n * MONTH_UNITS * 12);
                    }
                }
            }
            start = next;
        }
    }

    function _c5Period(uint256 rate, uint8 rp, uint8 bp, uint256 from, uint256 to, uint256 exact) internal pure {
        uint256 got = Calendar.earned(rate, rp, from, to);
        if (got != exact || got > Calendar.periodFigure(rate, rp, bp) * SCALE) revert Broken(from);
    }

    /// @dev C6: every month pays exactly one month of a monthly or yearly rate, and every run of 12 whole
    /// months walked pays a yearly rate exactly.
    function testExhaustive_C6_wholeMonths() external view {
        uint256 end = _months();
        uint256 start;
        uint256 rate = type(uint128).max;
        for (uint256 i; i < end; ++i) {
            uint256 next = Calendar.nextMonthStart(start);
            if (Calendar.earned(1, ICalendar.MONTH, start, next) != SCALE) revert Broken(i);
            if (Calendar.earned(12, ICalendar.YEAR, start, next) != SCALE) revert Broken(i);
            if (Calendar.earned(rate, ICalendar.YEAR, start, _monthsAfter(next, 11)) != rate * SCALE) revert Broken(i);
            start = next;
        }
    }

    function _monthsAfter(uint256 t, uint256 n) internal pure returns (uint256) {
        for (uint256 i; i < n; ++i) {
            t = Calendar.nextMonthStart(t);
        }
        return t;
    }

    /// @dev Written apart from the library: the Gregorian rule.
    function _isLeap(uint256 year) internal pure returns (bool) {
        return (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    }

    function _daysIn(uint256 year, uint256 month) internal pure returns (uint256) {
        if (month == 2) return _isLeap(year) ? 29 : 28;
        if (month == 4 || month == 6 || month == 9 || month == 11) return 30;
        return 31;
    }

    function testExhaustive_C9_periodIndex_month() external view {
        _c9(ICalendar.BUDGET_MONTH);
    }

    function testExhaustive_C9_periodIndex_quarter() external view {
        _c9(ICalendar.BUDGET_QUARTER);
    }

    function testExhaustive_C9_periodIndex_year() external view {
        _c9(ICalendar.BUDGET_YEAR);
    }
}
