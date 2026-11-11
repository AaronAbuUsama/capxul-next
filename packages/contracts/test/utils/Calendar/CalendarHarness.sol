// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Calendar } from "../../../src/libraries/Calendar.sol";

/// @notice Exposes every `internal` Calendar function as an external call, so tests can expect a revert
/// (`vm.expectRevert`) and Halmos checks can turn a revert into a counterexample (`try ... catch`).
contract CalendarHarness {
    function clock(uint8 period, uint256 t) external pure returns (uint256) {
        return Calendar.clock(period, t);
    }

    function numerator(uint256 rate, uint8 period) external pure returns (uint256) {
        return Calendar.numerator(rate, period);
    }

    function earned(uint256 rate, uint8 period, uint256 from, uint256 to) external pure returns (uint256) {
        return Calendar.earned(rate, period, from, to);
    }

    function yearly(uint256 rate, uint8 period) external pure returns (uint256) {
        return Calendar.yearly(rate, period);
    }

    function periodFigure(uint256 rate, uint8 ratePeriod, uint8 budgetPeriod) external pure returns (uint256) {
        return Calendar.periodFigure(rate, ratePeriod, budgetPeriod);
    }

    function periodIndex(uint8 budgetPeriod, uint256 t) external pure returns (uint256) {
        return Calendar.periodIndex(budgetPeriod, t);
    }

    function periodStart(uint8 budgetPeriod, uint256 t) external pure returns (uint256) {
        return Calendar.periodStart(budgetPeriod, t);
    }

    function nextPeriodStart(uint8 budgetPeriod, uint256 t) external pure returns (uint256) {
        return Calendar.nextPeriodStart(budgetPeriod, t);
    }

    function monthOf(uint256 t) external pure returns (uint256 index, uint256 start, uint256 length) {
        return Calendar.monthOf(t);
    }

    function monthStart(uint256 t) external pure returns (uint256) {
        return Calendar.monthStart(t);
    }

    function nextMonthStart(uint256 t) external pure returns (uint256) {
        return Calendar.nextMonthStart(t);
    }

    function monthsBetween(uint256 from, uint256 to) external pure returns (uint256) {
        return Calendar.monthsBetween(from, to);
    }

    function dateOf(uint256 days_) external pure returns (uint256 year, uint256 month, uint256 day) {
        return Calendar.dateOf(days_);
    }

    function daysOf(uint256 year, uint256 month, uint256 day) external pure returns (uint256) {
        return Calendar.daysOf(year, month, day);
    }

    function daysInMonth(uint256 year, uint256 month) external pure returns (uint256) {
        return Calendar.daysInMonth(year, month);
    }

    function isLeapYear(uint256 year) external pure returns (bool) {
        return Calendar.isLeapYear(year);
    }
}
