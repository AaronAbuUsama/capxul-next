// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IAgreements } from "../../../../../src/interfaces/IAgreements.sol";
import { Agreements_Unit_Shared } from "../../../../utils/Agreements/Agreements_Unit_Shared.sol";

/// @notice spec/agreements.md `reservation` (the budget's period replaces beta's year); invariant A9.
/// Ports beta `PayrollDepartmentsFixedTerm.fork.t.sol:188` (a short term reserves its exact pay, rounded
/// down) with spec/calendar.md's period-figure table.
contract Reservation_Agreements_Unit_Concrete_Test is Agreements_Unit_Shared {
    function test_WhenTheAgreementIsOpenEnded() external view {
        uint64 s = _now();
        // it should return the period figure for the budget's period
        assertEq(agreements.reservation(SALARY, MONTH, BUDGET_YEAR, s, 0), 60_000e6, "12 months");
        assertEq(agreements.reservation(SALARY, MONTH, BUDGET_QUARTER, s, 0), 15_000e6, "3 months");
        assertEq(agreements.reservation(SALARY, MONTH, BUDGET_MONTH, s, 0), SALARY, "1 month");
        assertEq(agreements.reservation(1000e6, WEEK, BUDGET_YEAR, s, 0), 53_000e6, "53 weeks");
        assertEq(agreements.reservation(1000e6, WEEK, BUDGET_QUARTER, s, 0), 14_000e6, "14 weeks");
        assertEq(agreements.reservation(1000e6, WEEK, BUDGET_MONTH, s, 0), 5000e6, "5 weeks");
        assertEq(agreements.reservation(60_000e6 + 1, YEAR, BUDGET_YEAR, s, 0), 60_000e6 + 1, "a year");
        assertEq(agreements.reservation(60_000e6 + 1, YEAR, BUDGET_QUARTER, s, 0), 15_000e6 + 1, "a quarter, up");
        assertEq(agreements.reservation(60_000e6 + 1, YEAR, BUDGET_MONTH, s, 0), 5000e6 + 1, "a twelfth, up");
    }

    function test_WhenAFixedTermPaysLessInTotalThanThePeriodFigure() external view {
        // it should return the term's exact calendar pay rounded down
        uint64 s = _date(2026, 2, 1);
        uint64 e = _date(2026, 3, 15);
        uint128 exact = _units(SALARY, MONTH, s, e); // February, then 14 of March's 31 days
        assertEq(exact, 7_258_064_516, "5,000 + 5,000 x 14/31, rounded down");
        assertEq(agreements.reservation(SALARY, MONTH, BUDGET_YEAR, s, e), exact, "less than 60,000");
        assertEq(
            agreements.reservation(1000e6, WEEK, BUDGET_YEAR, s, s + 10 days),
            _units(1000e6, WEEK, s, s + 10 days),
            "ten days of a weekly rate"
        );
    }

    function test_WhenAFixedTermPaysAtLeastThePeriodFigure() external view {
        // it should return the period figure
        uint64 s = _date(2026, 1, 1);
        assertEq(agreements.reservation(SALARY, MONTH, BUDGET_MONTH, s, _date(2026, 4, 1)), SALARY, "a month's figure");
        assertEq(
            agreements.reservation(SALARY, MONTH, BUDGET_YEAR, s, _date(2028, 1, 1)), 60_000e6, "two years, a year's"
        );
        assertEq(agreements.reservation(SALARY, MONTH, BUDGET_YEAR, s, _date(2027, 1, 1)), 60_000e6, "exactly a year");
    }

    function test_WhenTheFigureDoesNotFitIn128Bits() external {
        // it should revert with InvalidRate
        vm.expectRevert(IAgreements.InvalidRate.selector);
        agreements.reservation(type(uint128).max, WEEK, BUDGET_YEAR, _now(), 0);
        vm.expectRevert(IAgreements.InvalidRate.selector);
        agreements.reservation(type(uint128).max / 2, MONTH, BUDGET_QUARTER, _now(), 0);
    }
}
