// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Calendar_Shared_Test } from "../../../../utils/Calendar/Calendar_Shared_Test.sol";
import { CalendarModel } from "../../../../utils/Calendar/CalendarModel.sol";

contract PeriodFigure_Calendar_Unit_Concrete_Test is Calendar_Shared_Test {
    function test_WhenTheRatePeriodIsNotWEEKOrMONTHOrYEAR() external {
        // it should revert with InvalidPeriod
        _expectInvalidPeriod(3);
        calendar.periodFigure(1000, 3, BUDGET_MONTH);
        // Both unknown: the rate period is checked first.
        _expectInvalidPeriod(type(uint8).max);
        calendar.periodFigure(1000, type(uint8).max, type(uint8).max);
    }

    function test_WhenTheBudgetPeriodIsNotBUDGET_MONTHOrBUDGET_QUARTEROrBUDGET_YEAR() external {
        // it should revert with InvalidBudgetPeriod
        _expectInvalidBudgetPeriod(3);
        calendar.periodFigure(1000, MONTH, 3);
        _expectInvalidBudgetPeriod(type(uint8).max);
        calendar.periodFigure(1000, WEEK, type(uint8).max);
    }

    modifier whenTheBudgetPeriodIsBUDGET_MONTH() {
        _;
    }

    function test_WhenTheRatePeriodIsWEEK() external view whenTheBudgetPeriodIsBUDGET_MONTH {
        // it should return rate times 5
        assertEq(calendar.periodFigure(250e6, WEEK, BUDGET_MONTH), 1250e6);
    }

    function test_WhenTheRatePeriodIsMONTH() external view whenTheBudgetPeriodIsBUDGET_MONTH {
        // it should return rate
        assertEq(calendar.periodFigure(3000e6, MONTH, BUDGET_MONTH), 3000e6);
    }

    function test_WhenTheRatePeriodIsYEAR() external view whenTheBudgetPeriodIsBUDGET_MONTH {
        // it should return rate divided by 12 rounded up
        assertEq(calendar.periodFigure(12, YEAR, BUDGET_MONTH), 1, "exact");
        assertEq(calendar.periodFigure(13, YEAR, BUDGET_MONTH), 2, "rounded up");
        assertEq(calendar.periodFigure(40_000e6, YEAR, BUDGET_MONTH), 3_333_333_334, "40,000 a year");
        assertEq(calendar.periodFigure(0, YEAR, BUDGET_MONTH), 0, "zero");
    }

    modifier whenTheBudgetPeriodIsBUDGET_QUARTER() {
        _;
    }

    function test_WhenTheRatePeriodIsWEEK_WhenTheBudgetPeriodIsBUDGET_QUARTER()
        external
        view
        whenTheBudgetPeriodIsBUDGET_QUARTER
    {
        // it should return rate times 14
        assertEq(calendar.periodFigure(250e6, WEEK, BUDGET_QUARTER), 3500e6);
    }

    function test_WhenTheRatePeriodIsMONTH_WhenTheBudgetPeriodIsBUDGET_QUARTER()
        external
        view
        whenTheBudgetPeriodIsBUDGET_QUARTER
    {
        // it should return rate times 3
        assertEq(calendar.periodFigure(3000e6, MONTH, BUDGET_QUARTER), 9000e6);
    }

    function test_WhenTheRatePeriodIsYEAR_WhenTheBudgetPeriodIsBUDGET_QUARTER()
        external
        view
        whenTheBudgetPeriodIsBUDGET_QUARTER
    {
        // it should return rate divided by 4 rounded up
        assertEq(calendar.periodFigure(8, YEAR, BUDGET_QUARTER), 2, "exact");
        assertEq(calendar.periodFigure(9, YEAR, BUDGET_QUARTER), 3, "rounded up");
        assertEq(calendar.periodFigure(1, YEAR, BUDGET_QUARTER), 1, "one unit");
    }

    function test_WhenTheBudgetPeriodIsBUDGET_YEAR() external view {
        // it should return yearly of the rate
        assertEq(calendar.periodFigure(250e6, WEEK, BUDGET_YEAR), 250e6 * 53, "WEEK");
        assertEq(calendar.periodFigure(3000e6, MONTH, BUDGET_YEAR), 3000e6 * 12, "MONTH");
        assertEq(calendar.periodFigure(40_000e6, YEAR, BUDGET_YEAR), 40_000e6, "YEAR");
    }

    /// @dev C5 on concrete dates: every budget period of 2026 to 2030, every rate period, a few rates whose
    /// divisions by 12 and 4 do not come out even. Period bounds come from the model, not the library.
    function test_ShouldNeverBeLessThanWhatTheRateEarnsInsideAnyOneBudgetPeriod() external view {
        // it should never be less than what the rate earns inside any one budget period
        uint256[4] memory rates = [uint256(1), 7, 13, 1_000_001];
        uint256 t = _date(2026, 1, 1);
        for (uint256 m; m < 60; ++m) {
            uint256 next = CalendarModel.nextMonthStart(t);
            uint256 quarterEnd = m % 3 == 0 ? _monthsAfter(t, 3) : 0;
            uint256 yearEnd = m % 12 == 0 ? _monthsAfter(t, 12) : 0;
            for (uint8 rp; rp <= YEAR; ++rp) {
                for (uint256 i; i < rates.length; ++i) {
                    uint256 r = rates[i];
                    assertLe(calendar.earned(r, rp, t, next), calendar.periodFigure(r, rp, BUDGET_MONTH) * SCALE);
                    if (quarterEnd != 0) {
                        assertLe(
                            calendar.earned(r, rp, t, quarterEnd), calendar.periodFigure(r, rp, BUDGET_QUARTER) * SCALE
                        );
                    }
                    if (yearEnd != 0) {
                        assertLe(calendar.earned(r, rp, t, yearEnd), calendar.periodFigure(r, rp, BUDGET_YEAR) * SCALE);
                    }
                }
            }
            t = next;
        }
    }

    function _monthsAfter(uint256 t, uint256 n) internal pure returns (uint256) {
        for (uint256 i; i < n; ++i) {
            t = CalendarModel.nextMonthStart(t);
        }
        return t;
    }
}
