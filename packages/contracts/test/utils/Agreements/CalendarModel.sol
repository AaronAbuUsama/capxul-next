// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @notice The Agreements tests' own calendar, written apart from the `Calendar` library. Ported from
/// beta `packages/contracts/test/base/CalendarModel.sol` (whole file): it walks months one by one from
/// 1 January 2026, 00:00 UTC, by the Gregorian leap rule, and adds each month's part as a fraction of
/// that month. It never uses the library's date arithmetic or its month clock. Added for v4: the
/// budget-period figure table of spec/calendar.md, written out by hand.
/// @dev Pay is scaled as the library scales it, so the two compare to the unit: one token unit is
/// `SCALE`, 12 months of 377,580 x 86,400.
library CalendarModel {
    uint8 internal constant WEEK = 0;
    uint8 internal constant MONTH = 1;
    uint8 internal constant YEAR = 2;
    uint8 internal constant BUDGET_MONTH = 0;
    uint8 internal constant BUDGET_QUARTER = 1;
    uint8 internal constant BUDGET_YEAR = 2;
    uint256 internal constant DAY = 1 days;
    uint256 internal constant ANCHOR = 1_767_225_600; // 2026-01-01T00:00:00Z
    uint256 internal constant LCM_DAYS = 377_580;
    uint256 internal constant SCALE = 12 * LCM_DAYS * DAY;

    /// @dev Scaled pay from `from` to `to`: a week's amount per 604,800 seconds; a month's amount (a
    /// year's / 12) per calendar month, month by month.
    function pay(uint256 rate, uint8 period, uint256 from, uint256 to) internal pure returns (uint256 scaled) {
        if (to <= from || rate == 0) return 0;
        if (period == WEEK) return rate * (to - from) * SCALE / (7 * DAY);
        uint256 yearly = period == MONTH ? rate * 12 : rate; // over SCALE, which is 12 months
        (uint256 start, uint256 year, uint256 month) = walkTo(from);
        uint256 t = from;
        while (t < to) {
            uint256 length = daysIn(year, month) * DAY;
            uint256 end = start + length < to ? start + length : to;
            scaled += yearly * (end - t) * (LCM_DAYS * DAY) / length;
            t = end;
            start += length;
            (year, month) = month == 12 ? (year + 1, 1) : (year, month + 1);
        }
    }

    /// @dev Pay in token units, rounded down.
    function units(uint256 rate, uint8 period, uint256 from, uint256 to) internal pure returns (uint256) {
        return pay(rate, period, from, to) / SCALE;
    }

    /// @dev spec/calendar.md's `periodFigure` table: the most one budget period can pay, rounded up.
    function periodFigure(uint256 rate, uint8 period, uint8 budgetPeriod) internal pure returns (uint256) {
        uint256[3] memory weekCounts = [uint256(5), 14, 53];
        uint256[3] memory monthCounts = [uint256(1), 3, 12];
        uint256[3] memory yearParts = [uint256(12), 4, 1];
        if (period == WEEK) return rate * weekCounts[budgetPeriod];
        if (period == MONTH) return rate * monthCounts[budgetPeriod];
        return (rate + yearParts[budgetPeriod] - 1) / yearParts[budgetPeriod];
    }

    /// @dev What an agreement reserves: the period figure, or a fixed term's exact pay if that is less.
    function reservation(
        uint256 rate,
        uint8 period,
        uint8 budgetPeriod,
        uint256 startsAt,
        uint256 endsAt
    )
        internal
        pure
        returns (uint256)
    {
        uint256 figure = periodFigure(rate, period, budgetPeriod);
        if (endsAt == 0 || endsAt <= startsAt) return figure;
        uint256 term = units(rate, period, startsAt, endsAt);
        return term < figure ? term : figure;
    }

    function monthStart(uint256 t) internal pure returns (uint256 start) {
        (start,,) = walkTo(t);
    }

    function nextMonthStart(uint256 t) internal pure returns (uint256) {
        (uint256 start, uint256 year, uint256 month) = walkTo(t);
        return start + daysIn(year, month) * DAY;
    }

    /// @dev 00:00 UTC on a date from 2026, found by walking.
    function date(uint256 year, uint256 month, uint256 day) internal pure returns (uint64) {
        (uint256 start, uint256 y, uint256 m) = (ANCHOR, 2026, 1);
        while (y != year || m != month) {
            start += daysIn(y, m) * DAY;
            (y, m) = m == 12 ? (y + 1, 1) : (y, m + 1);
        }
        return uint64(start + (day - 1) * DAY);
    }

    /// @dev The month holding `t`, found by walking from the anchor.
    function walkTo(uint256 t) internal pure returns (uint256 start, uint256 year, uint256 month) {
        require(t >= ANCHOR, "before the model's calendar");
        (start, year, month) = (ANCHOR, 2026, 1);
        while (start + daysIn(year, month) * DAY <= t) {
            start += daysIn(year, month) * DAY;
            (year, month) = month == 12 ? (year + 1, 1) : (year, month + 1);
        }
    }

    function daysIn(uint256 year, uint256 month) internal pure returns (uint256) {
        if (month == 2) return (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 ? 29 : 28;
        if (month == 4 || month == 6 || month == 9 || month == 11) return 30;
        return 31;
    }
}
