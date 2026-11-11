// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Base_Test } from "../../Base.t.sol";
import { ICalendar } from "../../../src/interfaces/ICalendar.sol";
import { CalendarHarness } from "./CalendarHarness.sol";
import { CalendarModel } from "./CalendarModel.sol";

/// @notice The base every Calendar test inherits: Base_Test plus the harness that exposes the library, and
/// dates built by the independent model (never by the library under test).
abstract contract Calendar_Shared_Test is Base_Test {
    uint8 internal constant WEEK = ICalendar.WEEK;
    uint8 internal constant MONTH = ICalendar.MONTH;
    uint8 internal constant YEAR = ICalendar.YEAR;
    uint8 internal constant BUDGET_MONTH = ICalendar.BUDGET_MONTH;
    uint8 internal constant BUDGET_QUARTER = ICalendar.BUDGET_QUARTER;
    uint8 internal constant BUDGET_YEAR = ICalendar.BUDGET_YEAR;
    uint256 internal constant DAY = ICalendar.DAY;
    uint256 internal constant LCM_DAYS = ICalendar.LCM_DAYS;
    uint256 internal constant MONTH_UNITS = ICalendar.MONTH_UNITS;
    uint256 internal constant SCALE = ICalendar.SCALE;
    uint256 internal constant WEEK_UNITS_PER_SECOND = ICalendar.WEEK_UNITS_PER_SECOND;
    /// @dev 1 Jan 2200: the far edge of the fuzzed dates (as beta's PayrollCalendar.t.sol:20).
    uint256 internal constant UNTIL = 7_258_118_400;

    CalendarHarness internal calendar;

    function _deployProtocol() internal virtual override {
        calendar = new CalendarHarness();
        vm.label(address(calendar), "Calendar");
    }

    /// @dev 00:00 UTC on a date, from the model.
    function _date(uint256 year, uint256 month, uint256 day) internal pure returns (uint256) {
        return CalendarModel.date(year, month, day);
    }

    /// @dev The model's month index `year * 12 + month - 1`.
    function _monthIndex(uint256 year, uint256 month) internal pure returns (uint256) {
        return year * 12 + month - 1;
    }

    function _expectInvalidPeriod(uint8 period) internal {
        vm.expectRevert(abi.encodeWithSelector(ICalendar.InvalidPeriod.selector, period));
    }

    function _expectInvalidBudgetPeriod(uint8 period) internal {
        vm.expectRevert(abi.encodeWithSelector(ICalendar.InvalidBudgetPeriod.selector, period));
    }
}
