// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IAgreements } from "../../../../src/interfaces/IAgreements.sol";
import { ICalendar } from "../../../../src/interfaces/ICalendar.sol";
import { CalendarModel } from "../../../utils/Agreements/CalendarModel.sol";
import { Agreements_Unit_Shared } from "../../../utils/Agreements/Agreements_Unit_Shared.sol";

/// @notice `offer` over its input ranges: the reservation committed, the date rules, the period.
contract Offer_Agreements_Unit_Fuzz_Test is Agreements_Unit_Shared {
    /// @dev Any period, either budget period, open-ended or a term of up to 400 days: the budget commits the
    /// model's reservation, and the agreement records it.
    function testFuzz_CommitsTheModelReservation(uint128 rate, uint8 period, bool monthly, uint32 term) external {
        period = uint8(bound(period, 0, 2));
        uint256 budgetId = monthly ? monthlyBudget : operations;
        uint8 budgetPeriod = monthly ? BUDGET_MONTH : BUDGET_YEAR;
        // Small enough that the figure fits the 20,000-a-month budget.
        rate = uint128(bound(rate, 1, period == WEEK ? 4000e6 : period == MONTH ? 20_000e6 : 240_000e6));
        uint64 endsAt = term % 2 == 0 ? 0 : _now() + uint64(bound(term, 1 hours, 400 days));
        uint64 expiry = endsAt == 0 ? _now() + 7 days : endsAt;
        vm.prank(users.jordan);
        uint256 id = agreements.offer(budgetId, users.alice, rate, period, 0, endsAt, 1, expiry, TERMS);
        uint256 expected = CalendarModel.reservation(rate, period, budgetPeriod, _now(), endsAt);
        assertEq(agreements.agreementOf(id).reserved, expected, "the agreement's reservation");
        assertEq(budgets.ownCommitted(budgetId), expected, "committed in the budget");
    }

    /// @dev Start, end and expiry anywhere within a year either side of now: accepted exactly when the start
    /// is not past, the expiry is in the future and an end is after the start and not before the expiry.
    function testFuzz_DateRules(uint32 startSeed, uint32 endSeed, uint32 expirySeed, bool openEnded) external {
        uint64 nowT = _now();
        uint64 startsAt = startSeed % 4 == 0 ? 0 : uint64(bound(startSeed, nowT - 365 days, nowT + 365 days));
        uint64 endsAt = openEnded ? 0 : uint64(bound(endSeed, nowT - 365 days, nowT + 730 days));
        uint64 expiry = uint64(bound(expirySeed, nowT - 30 days, nowT + 365 days));
        uint64 start = startsAt == 0 ? nowT : startsAt;
        bool ok = start >= nowT && expiry > nowT && (endsAt == 0 || (endsAt > start && expiry <= endsAt));
        vm.prank(users.jordan);
        if (!ok) vm.expectRevert(IAgreements.InvalidDate.selector);
        agreements.offer(operations, users.alice, 1e6, MONTH, startsAt, endsAt, MONTHLY, expiry, TERMS);
        if (ok) assertEq(agreements.agreementOf(1).startsAt, start, "starts at the start date, or now");
    }

    /// @dev Every period above YEAR is refused with the Calendar's error naming it.
    function testFuzz_RevertWhen_ThePeriodIsUnknown(uint8 period) external {
        period = uint8(bound(period, 3, type(uint8).max));
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(ICalendar.InvalidPeriod.selector, period));
        agreements.offer(operations, users.alice, 1e6, period, 0, 0, MONTHLY, _now() + 1 days, TERMS);
    }
}
