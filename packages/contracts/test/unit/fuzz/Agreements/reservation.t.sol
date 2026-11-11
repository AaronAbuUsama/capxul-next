// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IAgreements } from "../../../../src/interfaces/IAgreements.sol";
import { CalendarModel } from "../../../utils/Agreements/CalendarModel.sol";
import { Agreements_Unit_Shared } from "../../../utils/Agreements/Agreements_Unit_Shared.sol";

/// @notice `reservation` over its input ranges (A9). Ports beta `PayrollDepartmentsFixedTerm.fork.t.sol:201`
/// and `:264` (fuzz: a fixed term reserves min(figure, exact term pay) and never pays more).
contract Reservation_Agreements_Unit_Fuzz_Test is Agreements_Unit_Shared {
    /// @dev Open-ended: exactly the period figure, for every rate that fits.
    function testFuzz_OpenEndedIsThePeriodFigure(uint128 rate, uint8 period, uint8 budgetPeriod) external view {
        period = uint8(bound(period, 0, 2));
        budgetPeriod = uint8(bound(budgetPeriod, 0, 2));
        rate = uint128(bound(rate, 1, type(uint128).max / 53));
        assertEq(
            agreements.reservation(rate, period, budgetPeriod, _now(), 0),
            _figure(rate, period, budgetPeriod),
            "the period figure"
        );
    }

    /// @dev A fixed term of 1 second to 800 days starting up to two years out: the lesser of the figure and
    /// the term's exact pay, so never above the figure and never below what the term pays (A9).
    function testFuzz_FixedTermIsTheLesserOfFigureAndTermPay(
        uint128 rate,
        uint8 period,
        uint8 budgetPeriod,
        uint32 startOffset,
        uint32 length
    )
        external
        view
    {
        period = uint8(bound(period, 0, 2));
        budgetPeriod = uint8(bound(budgetPeriod, 0, 2));
        rate = uint128(bound(rate, 1, 1e15)); // up to a billion units of a 6-decimal token per period
        uint64 s = uint64(START + bound(startOffset, 0, 730 days));
        uint64 e = s + uint64(bound(length, 1, 800 days));
        uint256 figure = CalendarModel.periodFigure(rate, period, budgetPeriod);
        uint256 term = CalendarModel.units(rate, period, s, e);
        uint128 r = agreements.reservation(rate, period, budgetPeriod, s, e);
        assertEq(r, term < figure ? term : figure, "min(figure, term pay)");
        assertLe(r, figure, "never above the figure");
        assertLe(term < figure ? term : 0, r, "a short term's pay fits its reservation");
    }

    /// @dev J13's fuzz half of Halmos `check_A9_reservationCoversPay` (bounded there to 2^8): a weekly fixed
    /// term of 31 days or of a leap year, at any rate above 2^8 up to 2^64, in each budget period, reserves
    /// min(figure, term pay rounded down) and never more than the figure.
    function testFuzz_WeeklyFixedTermToUint64CoversPay(uint128 rate, uint8 budgetPeriod, bool leapYear) external view {
        budgetPeriod = uint8(bound(budgetPeriod, 0, 2));
        rate = uint128(bound(rate, uint256(type(uint8).max) + 1, type(uint64).max));
        uint64 s = uint64(START);
        uint64 e = s + (leapYear ? 366 days : 31 days);
        uint256 figure = CalendarModel.periodFigure(rate, WEEK, budgetPeriod);
        uint256 term = CalendarModel.units(rate, WEEK, s, e);
        uint128 r = agreements.reservation(rate, WEEK, budgetPeriod, s, e);
        assertEq(r, term < figure ? term : figure, "min(figure, term pay)");
        assertLe(r, figure, "never above the figure");
    }

    /// @dev Any rate whose figure overflows 128 bits is refused.
    function testFuzz_RevertWhen_TheFigureOverflows(uint128 rate) external {
        rate = uint128(bound(rate, type(uint128).max / 53 + 1, type(uint128).max));
        vm.expectRevert(IAgreements.InvalidRate.selector);
        agreements.reservation(rate, WEEK, BUDGET_YEAR, _now(), 0);
    }
}
