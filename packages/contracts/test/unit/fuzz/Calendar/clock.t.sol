// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Calendar_Shared_Test } from "../../../utils/Calendar/Calendar_Shared_Test.sol";
import { CalendarModel } from "../../../utils/Calendar/CalendarModel.sol";

contract Clock_Calendar_Unit_Fuzz_Test is Calendar_Shared_Test {
    function testFuzz_Clock_Week(uint64 t) external view {
        assertEq(calendar.clock(WEEK, t), uint256(t) * WEEK_UNITS_PER_SECOND);
    }

    /// @dev The month clock against the model's month (beta PayrollCalendar.t.sol:160-171, ported).
    function testFuzz_Clock_MonthOrYear(uint256 t) external view {
        t = bound(t, 1, UNTIL);
        (uint256 start, uint256 year, uint256 month) = CalendarModel.walkTo(t);
        uint256 expected =
            _monthIndex(year, month) * MONTH_UNITS + (t - start) * (LCM_DAYS / CalendarModel.daysIn(year, month));
        assertEq(calendar.clock(MONTH, t), expected, "MONTH");
        assertEq(calendar.clock(YEAR, t), expected, "YEAR");
        assertLt(calendar.clock(YEAR, t - 1), calendar.clock(YEAR, t), "runs forward");
    }

    function testFuzz_Clock_RevertWhen_UnknownPeriod(uint8 period, uint256 t) external {
        period = uint8(bound(period, YEAR + 1, type(uint8).max));
        _expectInvalidPeriod(period);
        calendar.clock(period, t);
    }
}
