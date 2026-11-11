// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Calendar_Shared_Test } from "../../../utils/Calendar/Calendar_Shared_Test.sol";
import { CalendarModel } from "../../../utils/Calendar/CalendarModel.sol";

/// @dev R4 3.1 (V1): monthsBetween's monotonicity in `to` is a two-date domain, so it is fuzzed hard here.
contract MonthsBetween_Calendar_Unit_Fuzz_Test is Calendar_Shared_Test {
    function testFuzz_MonthsBetween_ZeroWhenToAtOrBeforeFrom(uint256 from, uint256 to) external view {
        to = bound(to, 0, from);
        assertEq(calendar.monthsBetween(from, to), 0);
    }

    function testFuzz_MonthsBetween_MatchesTheModel(uint256 from, uint256 to) external view {
        from = bound(from, 0, UNTIL);
        to = bound(to, from, from + 5 * 366 days);
        assertEq(calendar.monthsBetween(from, to), CalendarModel.monthsBetween(from, to));
    }

    function testFuzz_MonthsBetween_NeverDecreases(uint256 from, uint256 to1, uint256 to2) external view {
        from = bound(from, 0, UNTIL);
        to1 = bound(to1, from, UNTIL);
        to2 = bound(to2, to1, UNTIL);
        assertLe(calendar.monthsBetween(from, to1), calendar.monthsBetween(from, to2));
    }

    /// @dev The k-th step counts exactly at its second and not one second before.
    function testFuzz_MonthsBetween_CountsEachStepOnItsSecond(uint256 from, uint256 k) external view {
        from = bound(from, 0, UNTIL);
        k = bound(k, 1, 120);
        uint256 step = CalendarModel.stepAt(from, k);
        assertEq(calendar.monthsBetween(from, step), k, "on the step");
        assertEq(calendar.monthsBetween(from, step - 1), k - 1, "one second before");
    }
}
