// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { ICalendar } from "../interfaces/ICalendar.sol";

/// @title Calendar
/// @notice The UTC calendar every salary, budget period and vesting step uses (spec/calendar.md). A rate
/// per week pays over each 604,800 seconds; a rate per month or year pays one month's amount over each
/// calendar month, spread over that month's own seconds. Constants and errors live in `ICalendar`.
/// @dev Ported from beta `PayrollCalendar` (Capxul's own). Pay is a scaled numerator,
/// `rate * (clock(to) - clock(from))`, over `ICalendar.SCALE`, so no split of a period loses a remainder.
/// The month clock runs `MONTH_UNITS` per calendar month whatever its length (377,580 is lcm(28, 29, 30, 31)
/// days, so a second of any month is a whole number of units). Dates follow Howard Hinnant's
/// `civil_from_days` and `days_from_civil`, for timestamps from 1970.
library Calendar {
    uint256 private constant DAY = ICalendar.DAY;
    uint256 private constant LCM_DAYS = ICalendar.LCM_DAYS;

    /// @notice The clock a rate of `period` accrues by at Unix time `t`.
    function clock(uint8 period, uint256 t) internal pure returns (uint256) {
        _checkPeriod(period);
        if (period == ICalendar.WEEK) return t * ICalendar.WEEK_UNITS_PER_SECOND;
        (uint256 index, uint256 start, uint256 length) = monthOf(t);
        // forge-lint: disable-next-line(divide-before-multiply) -- LCM_DAYS divides by every month length: the quotient is exact
        return index * ICalendar.MONTH_UNITS + (t - start) * (LCM_DAYS / (length / DAY));
    }

    /// @notice `rate * 12` for `MONTH`, else `rate`.
    function numerator(uint256 rate, uint8 period) internal pure returns (uint256) {
        _checkPeriod(period);
        return period == ICalendar.MONTH ? rate * 12 : rate;
    }

    /// @notice Scaled pay `rate` per `period` earns from `from` to `to`; 0 if `to <= from`.
    function earned(uint256 rate, uint8 period, uint256 from, uint256 to) internal pure returns (uint256) {
        _checkPeriod(period);
        if (to <= from) return 0;
        return numerator(rate, period) * (clock(period, to) - clock(period, from));
    }

    /// @notice A rate as a yearly figure: `rate * 53` week, `rate * 12` month, `rate` year.
    function yearly(uint256 rate, uint8 period) internal pure returns (uint256) {
        _checkPeriod(period);
        if (period == ICalendar.WEEK) return rate * 53;
        return period == ICalendar.MONTH ? rate * 12 : rate;
    }

    /// @notice The most one budget period of `budgetPeriod` can pay at this rate, rounded up.
    function periodFigure(uint256 rate, uint8 ratePeriod, uint8 budgetPeriod) internal pure returns (uint256) {
        _checkPeriod(ratePeriod);
        _checkBudgetPeriod(budgetPeriod);
        // Weeks that cover a 31-day month (5), a 92-day quarter (14) and a year (53).
        if (ratePeriod == ICalendar.WEEK) return rate * (budgetPeriod == 0 ? 5 : budgetPeriod == 1 ? 14 : 53);
        // Months in a budget period: 1, 3, 12.
        uint256 months = budgetPeriod == 0 ? 1 : budgetPeriod == 1 ? 3 : 12;
        if (ratePeriod == ICalendar.MONTH) return rate * months;
        return Math.ceilDiv(rate, 12 / months);
    }

    /// @notice The index of the budget period holding `t`.
    function periodIndex(uint8 budgetPeriod, uint256 t) internal pure returns (uint256) {
        _checkBudgetPeriod(budgetPeriod);
        (uint256 year, uint256 month,) = dateOf(t / DAY);
        if (budgetPeriod == ICalendar.BUDGET_MONTH) return year * 12 + month - 1;
        if (budgetPeriod == ICalendar.BUDGET_QUARTER) return year * 4 + (month - 1) / 3;
        return year;
    }

    /// @notice 00:00 UTC on the first day of the budget period holding `t`.
    function periodStart(uint8 budgetPeriod, uint256 t) internal pure returns (uint256) {
        _checkBudgetPeriod(budgetPeriod);
        if (budgetPeriod == ICalendar.BUDGET_MONTH) return monthStart(t);
        (uint256 year, uint256 month,) = dateOf(t / DAY);
        uint256 first = budgetPeriod == ICalendar.BUDGET_QUARTER ? month - (month - 1) % 3 : 1;
        return daysOf(year, first, 1) * DAY;
    }

    /// @notice 00:00 UTC on the first day of the budget period after the one holding `t`.
    function nextPeriodStart(uint8 budgetPeriod, uint256 t) internal pure returns (uint256) {
        _checkBudgetPeriod(budgetPeriod);
        if (budgetPeriod == ICalendar.BUDGET_MONTH) return nextMonthStart(t);
        (uint256 year, uint256 month,) = dateOf(t / DAY);
        if (budgetPeriod == ICalendar.BUDGET_YEAR) return daysOf(year + 1, 1, 1) * DAY;
        uint256 next = month - (month - 1) % 3 + 3;
        return next > 12 ? daysOf(year + 1, 1, 1) * DAY : daysOf(year, next, 1) * DAY;
    }

    /// @notice The calendar month holding `t`: its index (`year*12 + month - 1`), first second and length.
    function monthOf(uint256 t) internal pure returns (uint256 index, uint256 start, uint256 length) {
        (uint256 year, uint256 month, uint256 day) = dateOf(t / DAY);
        index = year * 12 + month - 1;
        start = (t / DAY - (day - 1)) * DAY;
        length = daysInMonth(year, month) * DAY;
    }

    /// @notice 00:00 UTC on the 1st of the month holding `t`.
    function monthStart(uint256 t) internal pure returns (uint256 start) {
        (, start,) = monthOf(t);
    }

    /// @notice 00:00 UTC on the 1st of the month after the one holding `t`.
    function nextMonthStart(uint256 t) internal pure returns (uint256) {
        (, uint256 start, uint256 length) = monthOf(t);
        return start + length;
    }

    /// @notice Whole calendar-month steps from `from` to `to`. A step falls on `from`'s day of month and
    /// time of day, or on the month's last day (same time of day) if the month is shorter.
    function monthsBetween(uint256 from, uint256 to) internal pure returns (uint256) {
        if (to <= from) return 0;
        (uint256 y0, uint256 m0, uint256 d0) = dateOf(from / DAY);
        (uint256 y1, uint256 m1,) = dateOf(to / DAY);
        uint256 k = (y1 * 12 + m1) - (y0 * 12 + m0);
        if (k == 0) return 0;
        // Month `k` after `from`'s is `to`'s month; its step may fall after `to`, then one fewer.
        uint256 last = daysInMonth(y1, m1);
        uint256 step = (daysOf(y1, m1, 1) + (d0 < last ? d0 : last) - 1) * DAY + from % DAY;
        return step > to ? k - 1 : k;
    }

    /// @notice The UTC date of a day number since 1970-01-01 (`civil_from_days`).
    // forge-lint: disable-start(divide-before-multiply) -- Hinnant's integer calendar algorithm: its divisions floor by design
    function dateOf(uint256 days_) internal pure returns (uint256 year, uint256 month, uint256 day) {
        uint256 z = days_ + 719_468;
        uint256 era = z / 146_097;
        uint256 doe = z - era * 146_097;
        uint256 yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
        uint256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        uint256 mp = (5 * doy + 2) / 153;
        day = doy - (153 * mp + 2) / 5 + 1;
        month = mp < 10 ? mp + 3 : mp - 9;
        year = yoe + era * 400 + (month <= 2 ? 1 : 0);
    }

    /// @notice The day number since 1970-01-01 of a UTC date (`days_from_civil`); before 1970 reverts.
    function daysOf(uint256 year, uint256 month, uint256 day) internal pure returns (uint256) {
        // forge-lint: disable-next-line(require-revert-in-loop) -- an input guard; only the exhaustive tests call it in a loop
        if (year < 1970) revert ICalendar.DateBeforeEpoch();
        uint256 y = month <= 2 ? year - 1 : year;
        uint256 era = y / 400;
        uint256 yoe = y - era * 400;
        uint256 doy = (153 * (month > 2 ? month - 3 : month + 9) + 2) / 5 + day - 1;
        uint256 doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        return era * 146_097 + doe - 719_468;
    }

    // forge-lint: disable-end(divide-before-multiply)

    /// @notice The number of days in `month` of `year`.
    function daysInMonth(uint256 year, uint256 month) internal pure returns (uint256) {
        if (month == 2) return isLeapYear(year) ? 29 : 28;
        return month == 4 || month == 6 || month == 9 || month == 11 ? 30 : 31;
    }

    /// @notice Whether `year` is a Gregorian leap year.
    function isLeapYear(uint256 year) internal pure returns (bool) {
        return (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    }

    function _checkPeriod(uint8 period) private pure {
        // forge-lint: disable-next-line(require-revert-in-loop) -- an input guard; only the exhaustive tests call it in a loop
        if (period > ICalendar.YEAR) revert ICalendar.InvalidPeriod(period);
    }

    function _checkBudgetPeriod(uint8 period) private pure {
        // forge-lint: disable-next-line(require-revert-in-loop) -- an input guard; only the exhaustive tests call it in a loop
        if (period > ICalendar.BUDGET_YEAR) revert ICalendar.InvalidBudgetPeriod(period);
    }
}
