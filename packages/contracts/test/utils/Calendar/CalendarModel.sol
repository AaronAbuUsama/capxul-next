// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @notice The tests' own calendar, written apart from `Calendar`: it walks years and months one by one by
/// the Gregorian leap rule and never uses the library's date arithmetic or its month clock. Ported from beta
/// `packages/contracts/test/base/CalendarModel.sol:1-76` (Capxul's own), with `epochDays`, `stepAt` and
/// `monthsBetween` added for v4.
/// @dev Pay is scaled as the library scales it: one token unit is `SCALE`, 12 months of 377,580 x 86,400.
library CalendarModel {
    uint8 internal constant WEEK = 0;
    uint8 internal constant MONTH = 1;
    uint256 internal constant DAY = 1 days;
    uint256 internal constant ANCHOR = 1_767_225_600; // 2026-01-01T00:00:00Z
    uint256 internal constant LCM_DAYS = 377_580;
    uint256 internal constant SCALE = 12 * LCM_DAYS * DAY;

    /// @dev Scaled pay from `from` to `to`: a week's amount per 604,800 seconds; a month's amount (a year's
    /// / 12) per calendar month, month by month.
    function pay(uint256 rate, uint8 period, uint256 from, uint256 to) internal pure returns (uint256 scaled) {
        if (to <= from || rate == 0) return 0;
        if (period == WEEK) return rate * (to - from) * SCALE / (7 * DAY);
        uint256 perYear = period == MONTH ? rate * 12 : rate; // over SCALE, which is 12 months
        (uint256 start, uint256 year, uint256 month) = walkTo(from);
        uint256 t = from;
        while (t < to) {
            uint256 length = daysIn(year, month) * DAY;
            uint256 end = start + length < to ? start + length : to;
            scaled += perYear * (end - t) * (LCM_DAYS * DAY) / length;
            t = end;
            start += length;
            (year, month) = month == 12 ? (year + 1, 1) : (year, month + 1);
        }
    }

    function monthStart(uint256 t) internal pure returns (uint256 start) {
        (start,,) = walkTo(t);
    }

    function nextMonthStart(uint256 t) internal pure returns (uint256) {
        (uint256 start, uint256 year, uint256 month) = walkTo(t);
        return start + daysIn(year, month) * DAY;
    }

    /// @dev 00:00 UTC on a date from 1970, found by summing whole years and months.
    function date(uint256 year, uint256 month, uint256 day) internal pure returns (uint256) {
        return epochDays(year, month, day) * DAY;
    }

    /// @dev Days from 1970-01-01 to a date from 1970, by summing year and month lengths.
    function epochDays(uint256 year, uint256 month, uint256 day) internal pure returns (uint256 d) {
        require(year >= 1970, "before the model's calendar");
        for (uint256 y = 1970; y < year; ++y) {
            d += isLeap(y) ? 366 : 365;
        }
        for (uint256 m = 1; m < month; ++m) {
            d += daysIn(year, m);
        }
        d += day - 1;
    }

    /// @dev The month holding `t`, found by walking from the anchor (or from 1970 before it).
    function walkTo(uint256 t) internal pure returns (uint256 start, uint256 year, uint256 month) {
        (start, year, month) =
            t >= ANCHOR ? (ANCHOR, uint256(2026), uint256(1)) : (uint256(0), uint256(1970), uint256(1));
        while (start + daysIn(year, month) * DAY <= t) {
            start += daysIn(year, month) * DAY;
            (year, month) = month == 12 ? (year + 1, 1) : (year, month + 1);
        }
    }

    /// @dev The `k`-th whole-month step from `from`: the same day of month and time of day `k` months
    /// later, or that month's last day when it is shorter.
    function stepAt(uint256 from, uint256 k) internal pure returns (uint256) {
        (uint256 start, uint256 year, uint256 month) = walkTo(from);
        uint256 day = (from - start) / DAY + 1;
        uint256 timeOfDay = (from - start) % DAY;
        for (uint256 i; i < k; ++i) {
            start += daysIn(year, month) * DAY;
            (year, month) = month == 12 ? (year + 1, 1) : (year, month + 1);
        }
        uint256 last = daysIn(year, month);
        return start + ((day < last ? day : last) - 1) * DAY + timeOfDay;
    }

    /// @dev Whole calendar-month steps from `from` to `to`, counted one step at a time.
    function monthsBetween(uint256 from, uint256 to) internal pure returns (uint256 k) {
        if (to <= from) return 0;
        (uint256 start, uint256 year, uint256 month) = walkTo(from);
        uint256 day = (from - start) / DAY + 1;
        uint256 timeOfDay = (from - start) % DAY;
        while (true) {
            start += daysIn(year, month) * DAY;
            (year, month) = month == 12 ? (year + 1, 1) : (year, month + 1);
            uint256 last = daysIn(year, month);
            if (start + ((day < last ? day : last) - 1) * DAY + timeOfDay > to) return k;
            ++k;
        }
    }

    /// @dev The budget period (0 month, 1 quarter, 2 year) holding `t`: its index, first second and the
    /// first second of the next one, by walking months.
    function budgetPeriod(uint8 p, uint256 t) internal pure returns (uint256 index, uint256 start, uint256 next) {
        (uint256 s, uint256 year, uint256 month) = walkTo(t);
        uint256 firstMonth = p == 0 ? month : p == 1 ? month - (month - 1) % 3 : 1;
        uint256 count = p == 0 ? 1 : p == 1 ? 3 : 12;
        for (uint256 m = firstMonth; m < month; ++m) {
            s -= daysIn(year, m) * DAY;
        }
        start = s;
        next = s;
        for (uint256 m = firstMonth; m < firstMonth + count; ++m) {
            next += daysIn(year, m) * DAY;
        }
        index = p == 0 ? year * 12 + month - 1 : p == 1 ? year * 4 + (month - 1) / 3 : year;
    }

    function daysIn(uint256 year, uint256 month) internal pure returns (uint256) {
        if (month == 2) return isLeap(year) ? 29 : 28;
        if (month == 4 || month == 6 || month == 9 || month == 11) return 30;
        return 31;
    }

    function isLeap(uint256 year) internal pure returns (bool) {
        return (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    }
}
