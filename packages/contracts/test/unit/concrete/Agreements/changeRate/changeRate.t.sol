// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IAgreements } from "../../../../../src/interfaces/IAgreements.sol";
import { IBudgets } from "../../../../../src/interfaces/IBudgets.sol";
import { CalendarModel } from "../../../../utils/Agreements/CalendarModel.sol";
import { Agreements_Unit_Shared } from "../../../../utils/Agreements/Agreements_Unit_Shared.sol";

/// @notice spec/agreements.md `changeRate` (period figures replace beta's yearly figures, A2 in parts).
/// Ports beta `PayrollDepartments.fork.t.sol:115` and `PayrollDepartmentsEdges.fork.t.sol:224`, `:238`,
/// `:254`, `:302` (one change pending, a raise after a lowering counts from the lowered rate).
contract ChangeRate_Agreements_Unit_Concrete_Test is Agreements_Unit_Shared {
    uint256 internal id;
    uint64 internal t0;

    function test_WhenTheAgreementDoesNotExist() external {
        // it should revert with InvalidAgreement
        vm.expectRevert(IAgreements.InvalidAgreement.selector);
        vm.prank(users.jordan);
        agreements.changeRate(999, 3000e6, 0);
    }

    function test_WhenACallIntoAgreementsIsAlreadyRunning() external {
        id = _running();
        // it should revert with ReentrantCall
        _assertReentryRefused(abi.encodeCall(IAgreements.changeRate, (id, 6000e6, 0)));
        assertEq(agreements.agreementOf(id).rate, SALARY, "the re-entered raise did nothing");
    }

    function test_WhenTheCallerIsNotAuthorisedForTheAgreementsBudget() external {
        id = _running();
        address[3] memory outsiders = [address(users.eve), users.ben, users.alice];
        for (uint256 i; i < outsiders.length; ++i) {
            // it should revert with NotAuthorised
            vm.prank(outsiders[i]);
            vm.expectRevert(abi.encodeWithSelector(IAgreements.NotAuthorised.selector, operations, outsiders[i]));
            agreements.changeRate(id, 6000e6, 0);
        }
        // A wearer who lost the hat is refused at once (H6).
        hats.setStanding(OPS_HAT, users.jordan, false);
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IAgreements.NotAuthorised.selector, operations, users.jordan));
        agreements.changeRate(id, 6000e6, 0);
    }

    function test_WhenTheAgreementIsNotAccepted() external {
        id = _offer();
        // it should revert with NotAccepted
        vm.prank(users.jordan);
        vm.expectRevert(IAgreements.NotAccepted.selector);
        agreements.changeRate(id, 6000e6, 0);
    }

    modifier whenTheAgreementIsAccepted() {
        id = _running();
        t0 = _now();
        _;
    }

    function test_WhenTheAgreementIsAccepted() external whenTheAgreementIsAccepted {
        vm.prank(users.jordan);
        agreements.changeRate(id, 3000e6, t0 + 10 days);
        vm.warp(t0 + 15 days);
        // it should accrue to now first so a due lowering takes effect
        // 4,000 is a raise from the lowered 3,000, not a lowering from 5,000.
        vm.prank(users.jordan);
        agreements.changeRate(id, 4000e6, 0);
        IAgreements.Agreement memory a = agreements.agreementOf(id);
        assertEq(a.rate, 4000e6, "raised from the lowered rate");
        assertEq(a.pendingAt, 0, "the lowering was applied");
        assertEq(a.reserved, 48_000e6, "36,000 after the lowering plus 12,000 for the raise");
        assertEq(budgets.ownCommitted(operations), 48_000e6, "the budget agrees");
        uint256 scaled = CalendarModel.pay(SALARY, MONTH, t0, t0 + 10 days)
            + CalendarModel.pay(3000e6, MONTH, t0 + 10 days, t0 + 15 days);
        assertEq(agreements.earnedOf(id), scaled / SCALE, "each rate for its own days");
    }

    function test_WhenTheNewRateIs0OrEqualsTheCurrentRate() external whenTheAgreementIsAccepted {
        // it should revert with InvalidRate
        vm.prank(users.jordan);
        vm.expectRevert(IAgreements.InvalidRate.selector);
        agreements.changeRate(id, 0, t0);
        vm.prank(users.jordan);
        vm.expectRevert(IAgreements.InvalidRate.selector);
        agreements.changeRate(id, SALARY, t0);
    }

    function test_WhenTheAgreementHasAnEndDate() external whenTheAgreementIsAccepted {
        vm.prank(users.jordan);
        agreements.end(id, t0 + 30 days);
        // it should revert with AlreadyEnded
        vm.prank(users.jordan);
        vm.expectRevert(IAgreements.AlreadyEnded.selector);
        agreements.changeRate(id, 6000e6, 0);
        vm.prank(users.jordan);
        vm.expectRevert(IAgreements.AlreadyEnded.selector);
        agreements.changeRate(id, 3000e6, t0 + 1 days);

        // A fixed term keeps its rate too (A10).
        uint256 term = _offerTo(users.bob, SALARY, MONTH, 0, t0 + 60 days, MONTHLY);
        _accept(term);
        vm.prank(users.jordan);
        vm.expectRevert(IAgreements.AlreadyEnded.selector);
        agreements.changeRate(term, 6000e6, 0);
    }

    function test_WhenALoweringIsAlreadyPending() external whenTheAgreementIsAccepted {
        vm.prank(users.jordan);
        agreements.changeRate(id, 3000e6, t0 + 10 days);
        // it should revert with PendingChange
        vm.prank(users.jordan);
        vm.expectRevert(IAgreements.PendingChange.selector);
        agreements.changeRate(id, 2000e6, t0 + 20 days);
        vm.prank(users.jordan);
        vm.expectRevert(IAgreements.PendingChange.selector);
        agreements.changeRate(id, 6000e6, 0);
    }

    modifier whenTheNewRateIsHigher() {
        _;
    }

    function test_WhenTheNewRateIsHigher() external whenTheAgreementIsAccepted whenTheNewRateIsHigher {
        // Bob's agreement in the same budget ended yesterday and is not settled yet.
        uint256 bobs = _offerTo(users.bob, 1000e6, MONTH, 0, 0, MONTHLY);
        _accept(bobs);
        vm.prank(users.jordan);
        agreements.end(bobs, t0 + 1 days);
        vm.warp(t0 + 2 days);
        assertEq(budgets.ownCommitted(operations), 72_000e6, "Bob's 12,000 is still committed");
        // it should settle the budget first
        vm.prank(users.jordan);
        agreements.changeRate(id, 6000e6, 0);
        assertEq(budgets.ownCommitted(operations), 72_000e6, "Bob's 12,000 freed, Alice's 12,000 raise added");
        assertTrue(agreements.agreementOf(bobs).closed, "Bob's agreement closed");
        uint256[] memory open = agreements.openOf(operations);
        assertEq(open.length, 1, "only Alice's agreement is open");
        assertEq(open[0], id, "Alice's");
    }

    function test_WhenTheDifferenceOfThePeriodFiguresIsMoreThanIsLeftInTheBudget()
        external
        whenTheAgreementIsAccepted
        whenTheNewRateIsHigher
    {
        // it should revert with OverBudget from Budgets
        // 25,000 a month is 300,000 a year: 240,000 more, with 190,000 left of 250,000.
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.OverBudget.selector, operations, 190_000e6, 240_000e6));
        agreements.changeRate(id, 25_000e6, 0);
        assertEq(agreements.agreementOf(id).rate, SALARY, "unchanged");
    }

    function test_WhenTheDifferenceFits() external whenTheAgreementIsAccepted whenTheNewRateIsHigher {
        vm.warp(t0 + 10 days);
        // it should emit RateChanged effective now
        vm.expectEmit(address(agreements));
        emit IAgreements.RateChanged(address(safe), id, 6000e6, t0 + 10 days);
        vm.prank(users.jordan);
        agreements.changeRate(id, 6000e6, t0 + 40 days); // a raise ignores the date
        // it should commit the difference and add it to the reservation
        assertEq(agreements.agreementOf(id).reserved, 72_000e6, "60,000 plus 12,000");
        assertEq(budgets.ownCommitted(operations), 72_000e6, "committed in the budget");
        // it should pay the new rate from now
        vm.warp(t0 + 20 days);
        uint256 scaled = CalendarModel.pay(SALARY, MONTH, t0, t0 + 10 days)
            + CalendarModel.pay(6000e6, MONTH, t0 + 10 days, t0 + 20 days);
        assertEq(agreements.earnedOf(id), scaled / SCALE, "the new rate from the raise");
    }

    modifier whenTheNewRateIsLower() {
        _;
    }

    function test_WhenTheEffectiveDateIsInThePast() external whenTheAgreementIsAccepted whenTheNewRateIsLower {
        vm.warp(t0 + 1 days);
        // it should revert with InvalidDate
        vm.prank(users.jordan);
        vm.expectRevert(IAgreements.InvalidDate.selector);
        agreements.changeRate(id, 3000e6, t0);
    }

    modifier whenTheEffectiveDateIsNowOrLater() {
        _;
    }

    function test_WhenTheEffectiveDateIsNowOrLater()
        external
        whenTheAgreementIsAccepted
        whenTheNewRateIsLower
        whenTheEffectiveDateIsNowOrLater
    {
        uint64 effectiveAt = t0 + 10 days;
        // it should emit RateChanged with the effective date
        vm.expectEmit(address(agreements));
        emit IAgreements.RateChanged(address(safe), id, 3000e6, effectiveAt);
        vm.prank(users.jordan);
        agreements.changeRate(id, 3000e6, effectiveAt);
        // it should record the pending lowering
        IAgreements.Agreement memory a = agreements.agreementOf(id);
        assertEq(a.pendingAt, effectiveAt, "pending date");
        assertEq(a.pendingRate, 3000e6, "pending rate");
        assertEq(a.rate, SALARY, "the rate holds until then");
        // it should keep the reservation until the effective date
        vm.warp(effectiveAt - 1);
        vm.prank(users.eve);
        agreements.settle(operations);
        assertEq(agreements.agreementOf(id).reserved, 60_000e6, "reservation kept");
        assertEq(budgets.ownCommitted(operations), 60_000e6, "budget kept");
    }

    function test_GivenTheDateHasPassedAndTheAgreementIsNextBroughtUpToDate()
        external
        whenTheAgreementIsAccepted
        whenTheNewRateIsLower
        whenTheEffectiveDateIsNowOrLater
    {
        vm.prank(users.jordan);
        agreements.changeRate(id, 3000e6, t0 + 10 days);
        vm.warp(t0 + 12 days);
        assertEq(budgets.ownCommitted(operations), 60_000e6, "nothing freed until brought up to date");
        // it should release the difference of the period figures through Budgets release
        vm.expectEmit(address(agreements));
        emit IAgreements.ReservationReleased(address(safe), operations, id, 24_000e6);
        vm.prank(users.eve);
        agreements.settle(operations);
        assertEq(budgets.ownCommitted(operations), 36_000e6, "60,000 less 24,000");
        // it should keep the agreement open with the rest of its reservation
        IAgreements.Agreement memory a = agreements.agreementOf(id);
        assertFalse(a.closed, "still open");
        assertEq(a.reserved, 36_000e6, "3,000 a month for a year");
        assertEq(a.rate, 3000e6, "the lowered rate");
        assertEq(agreements.openOf(operations).length, 1, "still in the open list");
    }
}
