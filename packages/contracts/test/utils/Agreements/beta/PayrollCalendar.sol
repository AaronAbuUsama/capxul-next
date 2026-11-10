// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title PayrollCalendar
/// @notice The UTC calendar a payment agreement accrues by (CAP-989): a rate per
/// week pays its amount over each 604,800 seconds, and a rate per month or year
/// pays one month's amount over each UTC calendar month, spread over that
/// month's own seconds. So February and January each pay a whole month, and any
/// 12 whole calendar months pay a yearly rate exactly.
/// @dev Pay is kept as a scaled numerator, `rate × (clock(to) − clock(from))`,
/// over one denominator, `SCALE`, so no split of a period loses a remainder.
/// The month clock runs `MONTH` units per calendar month whatever its length:
/// 377,580 is the least common multiple of 28, 29, 30 and 31, so a second of
/// any month is a whole number of units. The week clock runs `SCALE` units per
/// week, so a weekly amount needs no ×12.
///
/// Dates follow Howard Hinnant's `civil_from_days` and `days_from_civil`, as
/// BokkyPooBah's DateTime library does, for timestamps from 1970.
library PayrollCalendar {
    /// @notice A rate's period: its amount is paid per week, per calendar month
    /// or per year of 12 calendar months.
    uint8 internal constant WEEK = 0;
    uint8 internal constant MONTH_PERIOD = 1;
    uint8 internal constant YEAR = 2;

    uint256 internal constant DAY = 86_400;
    /// @dev lcm(28, 29, 30, 31) days.
    uint256 internal constant LCM_DAYS = 377_580;
    /// @dev Month-clock units in one calendar month.
    uint256 internal constant MONTH = LCM_DAYS * DAY;
    /// @dev Units of scaled pay in one token unit: 12 months of a yearly rate.
    uint256 internal constant SCALE = 12 * MONTH;
    /// @dev Week-clock units per second: `SCALE` per 604,800 seconds.
    uint256 internal constant WEEK_UNITS_PER_SECOND = SCALE / (7 * DAY);

    /// @notice The clock a rate of `period` accrues by, at Unix time `t`.
    function clock(uint8 period, uint256 t) internal pure returns (uint256) {
        if (period == WEEK) return t * WEEK_UNITS_PER_SECOND;
        (uint256 index, uint256 start, uint256 length) = monthOf(t);
        return index * MONTH + (t - start) * (LCM_DAYS / (length / DAY));
    }

    /// @notice What the rate's amount is multiplied by on its period's clock:
    /// a month's amount counts 12 times over `SCALE`, a year's and a week's once.
    function numerator(uint256 rate, uint8 period) internal pure returns (uint256) {
        return period == MONTH_PERIOD ? rate * 12 : rate;
    }

    /// @notice The scaled pay `rate` earns from `from` to `to`.
    function earned(uint256 rate, uint8 period, uint256 from, uint256 to) internal pure returns (uint256) {
        if (to <= from) return 0;
        return numerator(rate, period) * (clock(period, to) - clock(period, from));
    }

    /// @notice A rate as a yearly figure, for budgets and reservations: a year's
    /// amount, 12 months, or 52 weeks and one more, so a year that spans 53
    /// weekly releases never outruns it.
    function yearly(uint256 rate, uint8 period) internal pure returns (uint256) {
        if (period == WEEK) return rate * 53;
        if (period == MONTH_PERIOD) return rate * 12;
        return rate;
    }

    /// @notice The calendar month holding `t`: its index (`year × 12 + month −
    /// 1`), its first second (00:00 UTC on the 1st) and its length in seconds.
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

    /// @notice The UTC date of a day number since 1970-01-01 (`civil_from_days`).
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

    /// @notice The day number since 1970-01-01 of a UTC date (`days_from_civil`), from 1970.
    function daysOf(uint256 year, uint256 month, uint256 day) internal pure returns (uint256) {
        uint256 y = month <= 2 ? year - 1 : year;
        uint256 era = y / 400;
        uint256 yoe = y - era * 400;
        uint256 doy = (153 * (month > 2 ? month - 3 : month + 9) + 2) / 5 + day - 1;
        uint256 doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        return era * 146_097 + doe - 719_468;
    }

    function daysInMonth(uint256 year, uint256 month) internal pure returns (uint256) {
        if (month == 2) return isLeapYear(year) ? 29 : 28;
        return month == 4 || month == 6 || month == 9 || month == 11 ? 30 : 31;
    }

    function isLeapYear(uint256 year) internal pure returns (bool) {
        return (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    }
}
