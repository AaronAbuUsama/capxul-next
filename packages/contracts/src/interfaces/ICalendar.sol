// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @title ICalendar
/// @notice The Calendar library's vocabulary: its period codes, its clock constants and its errors
/// (spec/calendar.md). A library rather than an interface, because only a library can hold constants;
/// the Calendar library reverts `ICalendar.<Error>` and contracts read `ICalendar.<CONSTANT>`.
library ICalendar {
    /// @notice Rate period: the amount is paid per week of 604,800 seconds.
    uint8 internal constant WEEK = 0;
    /// @notice Rate period: the amount is paid per calendar month.
    uint8 internal constant MONTH = 1;
    /// @notice Rate period: the amount is paid per year of 12 calendar months.
    uint8 internal constant YEAR = 2;

    /// @notice Budget period: a calendar month.
    uint8 internal constant BUDGET_MONTH = 0;
    /// @notice Budget period: a calendar quarter (Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec).
    uint8 internal constant BUDGET_QUARTER = 1;
    /// @notice Budget period: a calendar year.
    uint8 internal constant BUDGET_YEAR = 2;

    uint256 internal constant DAY = 86_400;
    /// @dev lcm(28, 29, 30, 31) days.
    uint256 internal constant LCM_DAYS = 377_580;
    /// @dev Month-clock units in one calendar month.
    uint256 internal constant MONTH_UNITS = LCM_DAYS * DAY;
    /// @dev Units of scaled pay in one token unit: 12 months of a yearly rate.
    uint256 internal constant SCALE = 12 * MONTH_UNITS;
    /// @dev Week-clock units per second: `SCALE` per 604,800 seconds.
    uint256 internal constant WEEK_UNITS_PER_SECOND = SCALE / (7 * DAY);

    /// @notice A rate period above `YEAR`.
    error InvalidPeriod(uint8 period);
    /// @notice A budget period above `BUDGET_YEAR`.
    error InvalidBudgetPeriod(uint8 period);
    /// @notice A date before 1 January 1970.
    error DateBeforeEpoch();
}
