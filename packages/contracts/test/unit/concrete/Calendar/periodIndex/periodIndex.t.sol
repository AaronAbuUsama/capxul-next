// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Calendar_Shared_Test } from "../../../../utils/Calendar/Calendar_Shared_Test.sol";

contract PeriodIndex_Calendar_Unit_Concrete_Test is Calendar_Shared_Test {
    function test_WhenTheBudgetPeriodIsBUDGET_MONTH() external view {
        // it should return year times 12 plus month minus 1
        assertEq(calendar.periodIndex(BUDGET_MONTH, _date(2026, 7, 15) + 3 hours), 2026 * 12 + 6, "July 2026");
        assertEq(calendar.periodIndex(BUDGET_MONTH, _date(2026, 8, 1) - 1), 2026 * 12 + 6, "last second of July");
        assertEq(calendar.periodIndex(BUDGET_MONTH, _date(2026, 8, 1)), 2026 * 12 + 7, "first second of August");
        assertEq(calendar.periodIndex(BUDGET_MONTH, 0), 1970 * 12, "the epoch");
    }

    modifier whenTheBudgetPeriodIsBUDGET_QUARTER() {
        _;
    }

    function test_WhenTheBudgetPeriodIsBUDGET_QUARTER() external view whenTheBudgetPeriodIsBUDGET_QUARTER {
        // it should return year times 4 plus the quarter of the year counted from 0
        assertEq(calendar.periodIndex(BUDGET_QUARTER, _date(2026, 1, 1)), 2026 * 4, "Q1 starts");
        assertEq(calendar.periodIndex(BUDGET_QUARTER, _date(2026, 8, 15)), 2026 * 4 + 2, "Q3");
        assertEq(calendar.periodIndex(BUDGET_QUARTER, _date(2027, 1, 1) - 1), 2026 * 4 + 3, "last second of Q4");
        assertEq(calendar.periodIndex(BUDGET_QUARTER, _date(2027, 1, 1)), 2027 * 4, "next year's Q1");
    }

    function test_GivenTIsTheFirstSecondOf1April() external view whenTheBudgetPeriodIsBUDGET_QUARTER {
        // it should return the second quarter of that year
        assertEq(calendar.periodIndex(BUDGET_QUARTER, _date(2027, 4, 1)), 2027 * 4 + 1, "1 April");
        assertEq(calendar.periodIndex(BUDGET_QUARTER, _date(2027, 4, 1) - 1), 2027 * 4, "one second before");
    }

    function test_WhenTheBudgetPeriodIsBUDGET_YEAR() external view {
        // it should return the year
        assertEq(calendar.periodIndex(BUDGET_YEAR, _date(2026, 12, 31) + 86_399), 2026);
        assertEq(calendar.periodIndex(BUDGET_YEAR, _date(2027, 1, 1)), 2027);
        assertEq(calendar.periodIndex(BUDGET_YEAR, 0), 1970);
    }

    function test_WhenTheBudgetPeriodIsAnythingElse() external {
        // it should revert with InvalidBudgetPeriod
        _expectInvalidBudgetPeriod(3);
        calendar.periodIndex(3, START);
        _expectInvalidBudgetPeriod(type(uint8).max);
        calendar.periodIndex(type(uint8).max, START);
        _expectInvalidBudgetPeriod(3);
        calendar.periodStart(3, START);
        _expectInvalidBudgetPeriod(3);
        calendar.nextPeriodStart(3, START);
    }

    /// @dev Monthly, quarterly and yearly rows ported from Firm `src/budget/test/TimeShiftLib.t.sol:26-53`
    /// (`assertShift`: a date to the start of the next period), plus each period's own start.
    function test_ShouldGivePeriodStartAtOrBeforeTAndNextPeriodStartAfterT() external view {
        // it should give periodStart at or before t and nextPeriodStart after t
        _assertPeriod(BUDGET_MONTH, _date(2022, 1, 1), _date(2022, 1, 1), _date(2022, 2, 1));
        _assertPeriod(BUDGET_MONTH, _date(2022, 1, 31), _date(2022, 1, 1), _date(2022, 2, 1));
        _assertPeriod(BUDGET_MONTH, _date(2022, 12, 3), _date(2022, 12, 1), _date(2023, 1, 1));
        _assertPeriod(BUDGET_MONTH, _date(2028, 2, 29) + 86_399, _date(2028, 2, 1), _date(2028, 3, 1));
        _assertPeriod(BUDGET_QUARTER, _date(2022, 1, 1), _date(2022, 1, 1), _date(2022, 4, 1));
        _assertPeriod(BUDGET_QUARTER, _date(2022, 1, 31), _date(2022, 1, 1), _date(2022, 4, 1));
        _assertPeriod(BUDGET_QUARTER, _date(2022, 4, 3), _date(2022, 4, 1), _date(2022, 7, 1));
        _assertPeriod(BUDGET_QUARTER, _date(2022, 5, 3), _date(2022, 4, 1), _date(2022, 7, 1));
        _assertPeriod(BUDGET_QUARTER, _date(2022, 6, 3), _date(2022, 4, 1), _date(2022, 7, 1));
        _assertPeriod(BUDGET_QUARTER, _date(2022, 10, 3), _date(2022, 10, 1), _date(2023, 1, 1));
        _assertPeriod(BUDGET_YEAR, _date(2022, 1, 1), _date(2022, 1, 1), _date(2023, 1, 1));
        _assertPeriod(BUDGET_YEAR, _date(2022, 1, 31), _date(2022, 1, 1), _date(2023, 1, 1));
        _assertPeriod(BUDGET_YEAR, _date(2023, 1, 1) - 1, _date(2022, 1, 1), _date(2023, 1, 1));
    }

    function _assertPeriod(uint8 p, uint256 t, uint256 start, uint256 next) internal view {
        uint256 s = calendar.periodStart(p, t);
        uint256 n = calendar.nextPeriodStart(p, t);
        assertEq(s, start, "periodStart");
        assertEq(n, next, "nextPeriodStart");
        assertLe(s, t, "at or before t");
        assertGt(n, t, "after t");
        assertEq(calendar.periodIndex(p, s), calendar.periodIndex(p, t), "same period at its start");
        assertEq(calendar.periodIndex(p, n), calendar.periodIndex(p, t) + 1, "the next period after it");
    }
}
