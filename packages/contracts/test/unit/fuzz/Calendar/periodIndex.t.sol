// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Calendar_Shared_Test } from "../../../utils/Calendar/Calendar_Shared_Test.sol";
import { CalendarModel } from "../../../utils/Calendar/CalendarModel.sol";

contract PeriodIndex_Calendar_Unit_Fuzz_Test is Calendar_Shared_Test {
    /// @dev The index, start and next start against the model, and C9 on the period around `t`.
    function testFuzz_PeriodIndex_MatchesTheModel(uint8 p, uint256 t) external view {
        p = uint8(bound(p, BUDGET_MONTH, BUDGET_YEAR));
        t = bound(t, 0, UNTIL);
        (uint256 index, uint256 start, uint256 next) = CalendarModel.budgetPeriod(p, t);
        assertEq(calendar.periodIndex(p, t), index, "index");
        assertEq(calendar.periodStart(p, t), start, "periodStart");
        assertEq(calendar.nextPeriodStart(p, t), next, "nextPeriodStart");
        assertEq(calendar.periodIndex(p, start), index, "constant from its start");
        assertEq(calendar.periodIndex(p, next - 1), index, "to its last second");
        assertEq(calendar.periodIndex(p, next), index + 1, "then the next index");
    }

    /// @dev C9: periodIndex never decreases in `t`.
    function testFuzz_PeriodIndex_Monotone(uint8 p, uint256 t1, uint256 t2) external view {
        p = uint8(bound(p, BUDGET_MONTH, BUDGET_YEAR));
        t1 = bound(t1, 0, UNTIL);
        t2 = bound(t2, t1, UNTIL);
        assertLe(calendar.periodIndex(p, t1), calendar.periodIndex(p, t2));
    }

    function testFuzz_PeriodIndex_RevertWhen_UnknownBudgetPeriod(uint8 p, uint256 t) external {
        p = uint8(bound(p, BUDGET_YEAR + 1, type(uint8).max));
        _expectInvalidBudgetPeriod(p);
        calendar.periodIndex(p, t);
    }
}
