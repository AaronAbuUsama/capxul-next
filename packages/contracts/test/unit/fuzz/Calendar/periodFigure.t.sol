// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Calendar_Shared_Test } from "../../../utils/Calendar/Calendar_Shared_Test.sol";
import { CalendarModel } from "../../../utils/Calendar/CalendarModel.sol";

contract PeriodFigure_Calendar_Unit_Fuzz_Test is Calendar_Shared_Test {
    /// @dev The table in spec/calendar.md, every cell.
    function testFuzz_PeriodFigure_Table(uint128 rate, uint8 ratePeriod, uint8 budgetPeriod) external view {
        ratePeriod = uint8(bound(ratePeriod, WEEK, YEAR));
        budgetPeriod = uint8(bound(budgetPeriod, BUDGET_MONTH, BUDGET_YEAR));
        uint256 r = rate;
        uint256 expected;
        if (ratePeriod == WEEK) {
            expected = r * [uint256(5), 14, 53][budgetPeriod];
        } else if (ratePeriod == MONTH) {
            expected = r * [uint256(1), 3, 12][budgetPeriod];
        } else {
            expected = budgetPeriod == BUDGET_YEAR
                ? r
                : (r + [uint256(12), 4][budgetPeriod] - 1) / [uint256(12), 4][budgetPeriod];
        }
        assertEq(calendar.periodFigure(r, ratePeriod, budgetPeriod), expected);
    }

    /// @dev C5: any window inside one budget period earns at most the period figure.
    function testFuzz_PeriodFigure_C5_NeverLessThanOnePeriodEarns(
        uint128 rate,
        uint8 ratePeriod,
        uint8 budgetPeriod,
        uint256 t,
        uint256 from,
        uint256 to
    )
        external
        view
    {
        ratePeriod = uint8(bound(ratePeriod, WEEK, YEAR));
        budgetPeriod = uint8(bound(budgetPeriod, BUDGET_MONTH, BUDGET_YEAR));
        t = bound(t, 0, UNTIL);
        (, uint256 start, uint256 next) = CalendarModel.budgetPeriod(budgetPeriod, t);
        from = bound(from, start, next);
        to = bound(to, from, next);
        uint256 figure = calendar.periodFigure(rate, ratePeriod, budgetPeriod) * SCALE;
        assertLe(calendar.earned(rate, ratePeriod, start, next), figure, "the whole period");
        assertLe(calendar.earned(rate, ratePeriod, from, to), figure, "a window inside it");
    }

    function testFuzz_PeriodFigure_RevertWhen_UnknownRatePeriod(
        uint256 rate,
        uint8 ratePeriod,
        uint8 budgetPeriod
    )
        external
    {
        ratePeriod = uint8(bound(ratePeriod, YEAR + 1, type(uint8).max));
        _expectInvalidPeriod(ratePeriod);
        calendar.periodFigure(rate, ratePeriod, budgetPeriod);
    }

    function testFuzz_PeriodFigure_RevertWhen_UnknownBudgetPeriod(
        uint256 rate,
        uint8 ratePeriod,
        uint8 budgetPeriod
    )
        external
    {
        ratePeriod = uint8(bound(ratePeriod, WEEK, YEAR));
        budgetPeriod = uint8(bound(budgetPeriod, BUDGET_YEAR + 1, type(uint8).max));
        _expectInvalidBudgetPeriod(budgetPeriod);
        calendar.periodFigure(rate, ratePeriod, budgetPeriod);
    }
}
