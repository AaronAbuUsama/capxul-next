// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { stdError } from "forge-std/StdError.sol";

import { Calendar_Shared_Test } from "../../../utils/Calendar/Calendar_Shared_Test.sol";
import { CalendarModel } from "../../../utils/Calendar/CalendarModel.sol";

/// @dev Ported from beta `packages/contracts/test/unit/PayrollCalendar.t.sol:92-153` (model match, splitting,
/// twelve whole months, rounding), with v4's unknown-period and overflow leaves added.
contract Earned_Calendar_Unit_Fuzz_Test is Calendar_Shared_Test {
    function testFuzz_Earned_ZeroWhenToAtOrBeforeFrom(
        uint256 rate,
        uint8 period,
        uint256 from,
        uint256 to
    )
        external
        view
    {
        period = uint8(bound(period, WEEK, YEAR));
        to = bound(to, 0, from);
        assertEq(calendar.earned(rate, period, from, to), 0);
    }

    /// @dev CL2: `earned` equals the month-by-month model to the unit.
    function testFuzz_Earned_MatchesTheModel(uint256 rate, uint8 period, uint256 from, uint256 to) external view {
        period = uint8(bound(period, WEEK, YEAR));
        rate = bound(rate, 0, type(uint128).max);
        from = bound(from, START, START + 20 * 366 days);
        to = bound(to, from, from + 4 * 366 days);
        assertEq(calendar.earned(rate, period, from, to), CalendarModel.pay(rate, period, from, to));
    }

    /// @dev C1: splitting a span anywhere loses nothing.
    function testFuzz_Earned_C1_SplittingLosesNothing(
        uint256 rate,
        uint8 period,
        uint256 a,
        uint256 b,
        uint256 c
    )
        external
        view
    {
        period = uint8(bound(period, WEEK, YEAR));
        rate = bound(rate, 0, type(uint128).max);
        a = bound(a, 0, UNTIL);
        b = bound(b, a, UNTIL);
        c = bound(c, b, UNTIL);
        assertEq(
            calendar.earned(rate, period, a, b) + calendar.earned(rate, period, b, c),
            calendar.earned(rate, period, a, c)
        );
    }

    /// @dev C2: earned never decreases as `to` moves forward.
    function testFuzz_Earned_C2_NeverDecreases(
        uint256 rate,
        uint8 period,
        uint256 from,
        uint256 to1,
        uint256 to2
    )
        external
        view
    {
        period = uint8(bound(period, WEEK, YEAR));
        rate = bound(rate, 0, type(uint128).max);
        from = bound(from, 0, UNTIL);
        to1 = bound(to1, from, UNTIL);
        to2 = bound(to2, to1, UNTIL);
        assertLe(calendar.earned(rate, period, from, to1), calendar.earned(rate, period, from, to2));
    }

    /// @dev C6: any 12 whole calendar months pay a yearly rate exactly, and a monthly rate 12 times.
    function testFuzz_Earned_C6_TwelveWholeMonthsPayTheYear(uint128 rate, uint256 t) external view {
        uint256 start = CalendarModel.monthStart(bound(t, 0, UNTIL));
        uint256 end = start;
        for (uint256 i; i < 12; ++i) {
            end = CalendarModel.nextMonthStart(end);
        }
        assertEq(calendar.earned(rate, YEAR, start, end), uint256(rate) * SCALE, "a yearly rate");
        assertEq(calendar.earned(rate, MONTH, start, end), uint256(rate) * 12 * SCALE, "a monthly rate");
    }

    /// @dev C7: rounding down never pays over the exact amount, and is short of it by under one unit.
    function testFuzz_Earned_C7_RoundingNeverOverAndUnderOneUnitShort(
        uint128 rate,
        uint8 period,
        uint256 from,
        uint256 to
    )
        external
        view
    {
        period = uint8(bound(period, WEEK, YEAR));
        from = bound(from, START, START + 20 * 366 days);
        to = bound(to, from, from + 4 * 366 days);
        uint256 scaled = calendar.earned(rate, period, from, to);
        uint256 exact = CalendarModel.pay(rate, period, from, to);
        assertEq(scaled, exact, "the exact scaled amount");
        uint256 paid = scaled / SCALE;
        assertLe(paid * SCALE, scaled, "never over");
        assertLt(scaled - paid * SCALE, SCALE, "short by under one unit");
    }

    function testFuzz_Earned_RevertWhen_UnknownPeriod(uint256 rate, uint8 period, uint256 from, uint256 to) external {
        period = uint8(bound(period, YEAR + 1, type(uint8).max));
        _expectInvalidPeriod(period);
        calendar.earned(rate, period, from, to);
    }

    /// @dev `numerator` (spec/calendar.md): `rate * 12` for MONTH, else `rate`; an unknown period reverts.
    function testFuzz_Numerator(uint256 rate, uint8 period) external {
        rate = bound(rate, 0, type(uint256).max / 12);
        assertEq(calendar.numerator(rate, WEEK), rate, "WEEK");
        assertEq(calendar.numerator(rate, MONTH), rate * 12, "MONTH");
        assertEq(calendar.numerator(rate, YEAR), rate, "YEAR");
        period = uint8(bound(period, YEAR + 1, type(uint8).max));
        _expectInvalidPeriod(period);
        calendar.numerator(rate, period);
    }

    function testFuzz_Earned_RevertWhen_ProductOverflows(uint256 rate, uint256 from) external {
        rate = bound(rate, type(uint256).max / WEEK_UNITS_PER_SECOND + 1, type(uint256).max);
        from = bound(from, 0, UNTIL);
        vm.expectRevert(stdError.arithmeticError);
        calendar.earned(rate, WEEK, from, from + 1);
    }
}
