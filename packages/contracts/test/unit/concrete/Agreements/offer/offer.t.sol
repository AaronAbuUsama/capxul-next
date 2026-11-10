// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Vm } from "forge-std/Vm.sol";

import { IAgreements } from "../../../../../src/interfaces/IAgreements.sol";
import { IBudgets } from "../../../../../src/interfaces/IBudgets.sol";
import { ICalendar } from "../../../../../src/interfaces/ICalendar.sol";
import { Agreements_Unit_Shared } from "../../../../utils/Agreements/Agreements_Unit_Shared.sol";

/// @notice spec/agreements.md `offer` (budget's token, period-figure reservation, 64 open, F10, D10).
/// Ports beta `PayrollDepartments.fork.t.sol:357`, `:368` (an offer reserves at once and pays nothing
/// until accepted), `PayrollDepartmentsEdges.fork.t.sol:190` (`:219-221`, refused dates and terms) and
/// `PayrollDepartmentsFixedTerm.fork.t.sol:136`, `:188` (a short fixed term reserves its exact pay).
contract Offer_Agreements_Unit_Concrete_Test is Agreements_Unit_Shared {
    uint64 internal expiry;

    function setUp() public override {
        super.setUp();
        expiry = _now() + 7 days;
    }

    function test_WhenACallIntoAgreementsIsAlreadyRunning() external {
        // it should revert with ReentrantCall
        _assertReentryRefused(
            abi.encodeCall(
                IAgreements.offer, (operations, users.bob, SALARY, MONTH, 0, 0, MONTHLY, expiry + 30 days, TERMS)
            )
        );
        assertEq(agreements.openOf(operations).length, 0, "no offer was made");
    }

    function test_WhenTheBudgetDoesNotExist() external {
        // it should revert with UnknownBudget from Budgets
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.UnknownBudget.selector, 999));
        agreements.offer(999, users.alice, SALARY, MONTH, 0, 0, MONTHLY, expiry, TERMS);
    }

    function test_WhenTheCallerIsNotAuthorisedForTheBudget() external {
        address[3] memory outsiders = [address(users.eve), users.ben, users.alice];
        for (uint256 i; i < outsiders.length; ++i) {
            // it should revert with NotAuthorised
            vm.prank(outsiders[i]);
            vm.expectRevert(abi.encodeWithSelector(IAgreements.NotAuthorised.selector, operations, outsiders[i]));
            agreements.offer(operations, users.bob, SALARY, MONTH, 0, 0, MONTHLY, expiry, TERMS);
        }
        // Jordan's hat is not the Operating budget's, which sits above Operations.
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IAgreements.NotAuthorised.selector, operating, users.jordan));
        agreements.offer(operating, users.bob, SALARY, MONTH, 0, 0, MONTHLY, expiry, TERMS);
        // Another company's Safe is not this company's Board (B7).
        vm.prank(otherSafe);
        vm.expectRevert(abi.encodeWithSelector(IAgreements.NotAuthorised.selector, operations, otherSafe));
        agreements.offer(operations, users.bob, SALARY, MONTH, 0, 0, MONTHLY, expiry, TERMS);
    }

    modifier whenTheCallerIsAuthorised() {
        _;
    }

    function test_WhenThePayeeIsTheZeroAddressOrTheRateIs0OrTheDocumentHashIsZero() external whenTheCallerIsAuthorised {
        vm.startPrank(users.jordan);
        // it should revert with InvalidAgreement
        vm.expectRevert(IAgreements.InvalidAgreement.selector);
        agreements.offer(operations, address(0), SALARY, MONTH, 0, 0, MONTHLY, expiry, TERMS);
        vm.expectRevert(IAgreements.InvalidAgreement.selector);
        agreements.offer(operations, users.alice, 0, MONTH, 0, 0, MONTHLY, expiry, TERMS);
        vm.expectRevert(IAgreements.InvalidAgreement.selector);
        agreements.offer(operations, users.alice, SALARY, MONTH, 0, 0, MONTHLY, expiry, bytes32(0));
        vm.stopPrank();
    }

    function test_WhenThePayeeIsTheCaller() external whenTheCallerIsAuthorised {
        // it should revert with InvalidAgreement
        vm.prank(users.jordan);
        vm.expectRevert(IAgreements.InvalidAgreement.selector);
        agreements.offer(operations, users.jordan, SALARY, MONTH, 0, 0, MONTHLY, expiry, TERMS);
        vm.prank(address(safe));
        vm.expectRevert(IAgreements.InvalidAgreement.selector);
        agreements.offer(operations, address(safe), SALARY, MONTH, 0, 0, MONTHLY, expiry, TERMS);
    }

    function test_WhenThePeriodIsNotWEEKOrMONTHOrYEAR() external whenTheCallerIsAuthorised {
        // it should revert with the Calendar's InvalidPeriod
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(ICalendar.InvalidPeriod.selector, uint8(3)));
        agreements.offer(operations, users.alice, SALARY, 3, 0, 0, MONTHLY, expiry, TERMS);
    }

    function test_WhenTheStepIs0() external whenTheCallerIsAuthorised {
        // it should revert with InvalidStep
        vm.prank(users.jordan);
        vm.expectRevert(IAgreements.InvalidStep.selector);
        agreements.offer(operations, users.alice, SALARY, MONTH, 0, 0, 0, expiry, TERMS);
    }

    function test_WhenTheStartDateIsInThePast() external whenTheCallerIsAuthorised {
        // it should revert with InvalidDate
        vm.prank(users.jordan);
        vm.expectRevert(IAgreements.InvalidDate.selector);
        agreements.offer(operations, users.alice, SALARY, MONTH, _now() - 1, 0, MONTHLY, expiry, TERMS);
    }

    function test_WhenTheOfferExpiryIsNotInTheFuture() external whenTheCallerIsAuthorised {
        // it should revert with InvalidDate
        vm.prank(users.jordan);
        vm.expectRevert(IAgreements.InvalidDate.selector);
        agreements.offer(operations, users.alice, SALARY, MONTH, 0, 0, MONTHLY, _now(), TERMS);
    }

    function test_WhenAnEndIsSetAtOrBeforeTheStartOrBeforeTheOfferExpiry() external whenTheCallerIsAuthorised {
        uint64 startsAt = _now() + 10 days;
        vm.startPrank(users.jordan);
        // it should revert with InvalidDate
        vm.expectRevert(IAgreements.InvalidDate.selector);
        agreements.offer(operations, users.alice, SALARY, MONTH, startsAt, startsAt, MONTHLY, expiry, TERMS);
        vm.expectRevert(IAgreements.InvalidDate.selector);
        agreements.offer(operations, users.alice, SALARY, MONTH, startsAt, startsAt - 1, MONTHLY, expiry, TERMS);
        // An end before the offer expiry: the offer could be accepted after the agreement ended.
        vm.expectRevert(IAgreements.InvalidDate.selector);
        agreements.offer(operations, users.alice, SALARY, MONTH, 0, expiry - 1, MONTHLY, expiry, TERMS);
        vm.stopPrank();
    }

    function test_WhenTheBudgetAlreadyHas64OpenAgreements() external whenTheCallerIsAuthorised {
        vm.startPrank(users.jordan);
        for (uint160 i; i < 64; ++i) {
            agreements.offer(operations, address(0x1000 + i), 1e6, MONTH, 0, 0, MONTHLY, expiry, TERMS);
        }
        // it should revert with TooManyAgreements
        vm.expectRevert(IAgreements.TooManyAgreements.selector);
        agreements.offer(operations, users.alice, 1e6, MONTH, 0, 0, MONTHLY, expiry, TERMS);
        vm.stopPrank();
        assertEq(agreements.openOf(operations).length, 64, "64 open");
        // Another budget is not affected.
        vm.prank(users.jordan);
        agreements.offer(monthlyBudget, users.alice, 1e6, MONTH, 0, 0, MONTHLY, expiry, TERMS);
    }

    modifier whenTheTermsAreValid() {
        _;
    }

    function test_WhenTheTermsAreValid() external whenTheCallerIsAuthorised whenTheTermsAreValid {
        uint256 ended = _running();
        vm.prank(users.jordan);
        agreements.end(ended, _now() + 1 days);
        uint256 lapsed = _offerTo(users.bob, SALARY, MONTH, 0, 0, MONTHLY);
        vm.warp(_now() + 8 days);
        assertEq(budgets.ownCommitted(operations), 120_000e6, "both still committed");
        // it should settle the budget's open agreements first
        vm.recordLogs();
        uint256 id = _offerTo(users.alice, 1000e6, MONTH, 0, 0, MONTHLY);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(_releasedIn(logs, ended), 60_000e6, "ReservationReleased for the ended agreement");
        assertEq(_releasedIn(logs, lapsed), 60_000e6, "ReservationReleased for the lapsed offer");
        assertEq(budgets.ownCommitted(operations), 12_000e6, "only the new offer is committed");
        uint256[] memory open = agreements.openOf(operations);
        assertEq(open.length, 1, "the ended and lapsed agreements left the open list");
        assertEq(open[0], id, "the new offer");
    }

    function test_GivenTheStartDateIs0() external whenTheCallerIsAuthorised whenTheTermsAreValid {
        vm.warp(_now() + 3 hours);
        uint256 id = _offer();
        // it should start now
        IAgreements.Agreement memory a = agreements.agreementOf(id);
        assertEq(a.startsAt, _now(), "starts now");
        assertEq(a.accruedAt, _now(), "checkpoint now");
    }

    function test_WhenTheBudgetOrABudgetAboveItIsClosed() external whenTheCallerIsAuthorised whenTheTermsAreValid {
        budgets.setClosed(operations, true);
        // it should revert with BudgetIsClosed from Budgets
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.BudgetIsClosed.selector, operations));
        agreements.offer(operations, users.alice, SALARY, MONTH, 0, 0, MONTHLY, expiry, TERMS);
        budgets.setClosed(operations, false);
        budgets.setClosed(operating, true);
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.BudgetIsClosed.selector, operating));
        agreements.offer(operations, users.alice, SALARY, MONTH, 0, 0, MONTHLY, expiry, TERMS);
    }

    function test_WhenTheReservationIsMoreThanIsLeftInTheBudget()
        external
        whenTheCallerIsAuthorised
        whenTheTermsAreValid
    {
        // it should revert with OverBudget from Budgets
        // 25,000 a month is 300,000 a year, against 250,000.
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.OverBudget.selector, operations, 250_000e6, 300_000e6));
        agreements.offer(operations, users.alice, 25_000e6, MONTH, 0, 0, MONTHLY, expiry, TERMS);
    }

    modifier whenTheReservationFits() {
        _;
    }

    function test_WhenTheReservationFits()
        external
        whenTheCallerIsAuthorised
        whenTheTermsAreValid
        whenTheReservationFits
    {
        uint64 startsAt = _now() + 2 days;
        uint64 endsAt = _date(2027, 2, 1); // a 13-month term pays more than a year's figure
        // it should emit AgreementOffered and AgreementEnded if an end is set
        vm.expectEmit(address(agreements));
        emit IAgreements.AgreementOffered(
            address(safe), operations, 1, address(usdc), users.alice, SALARY, MONTH, startsAt, MONTHLY, expiry, TERMS
        );
        vm.expectEmit(address(agreements));
        emit IAgreements.AgreementEnded(address(safe), 1, endsAt);
        vm.prank(users.jordan);
        uint256 id = agreements.offer(operations, users.alice, SALARY, MONTH, startsAt, endsAt, MONTHLY, expiry, TERMS);
        // it should return the next agreement id
        assertEq(id, 1, "ids run from 1");
        assertEq(agreements.agreementCount(), 1, "one offered");
        // it should commit the reservation in the budget
        assertEq(budgets.ownCommitted(operations), 60_000e6, "a year of salary, the term pays more");
        // it should record the budget's token as the agreement's token
        IAgreements.Agreement memory a = agreements.agreementOf(id);
        assertEq(a.token, address(usdc), "the budget's token");
        assertEq(a.safe, address(safe), "the budget's Safe");
        assertEq(a.budgetId, operations, "the budget");
        assertEq(a.payee, users.alice, "payee");
        assertEq(a.rate, SALARY, "rate");
        assertEq(a.period, MONTH, "period");
        assertEq(a.startsAt, startsAt, "start");
        assertEq(a.accruedAt, startsAt, "checkpoint at the start");
        assertEq(a.endsAt, endsAt, "end");
        assertEq(a.step, MONTHLY, "step");
        assertEq(a.offerExpiresAt, expiry, "expiry");
        assertEq(a.reserved, 60_000e6, "reserved");
        assertEq(a.documentHash, TERMS, "document");
        assertFalse(a.accepted, "not accepted yet");
        // it should add the agreement to the budget's open list
        uint256[] memory open = agreements.openOf(operations);
        assertEq(open.length, 1, "one open");
        assertEq(open[0], id, "this one");
        // An ancestor budget's hat and the Board may offer too, and ids keep counting.
        vm.prank(users.amira);
        assertEq(agreements.offer(operations, users.bob, 1000e6, MONTH, 0, 0, MONTHLY, expiry, TERMS), 2, "id 2");
        vm.prank(address(safe));
        assertEq(agreements.offer(operations, users.bob, 1000e6, MONTH, 0, 0, MONTHLY, expiry, TERMS), 3, "id 3");
        assertEq(budgets.ownCommitted(operations), 84_000e6, "three reservations");
    }

    function test_GivenTheAgreementIsOpenEnded()
        external
        whenTheCallerIsAuthorised
        whenTheTermsAreValid
        whenTheReservationFits
    {
        vm.startPrank(users.jordan);
        // it should reserve the rate's figure for the budget's period
        uint256 weekly = agreements.offer(operations, users.alice, 1000e6, WEEK, 0, 0, 1, expiry, TERMS);
        assertEq(agreements.agreementOf(weekly).reserved, 53_000e6, "53 weeks in a budget year");
        uint256 weeklyInMonth = agreements.offer(monthlyBudget, users.alice, 1000e6, WEEK, 0, 0, 1, expiry, TERMS);
        assertEq(agreements.agreementOf(weeklyInMonth).reserved, 5000e6, "5 weeks cover any month");
        uint256 yearlyInMonth = agreements.offer(monthlyBudget, users.bob, 120_001e6, YEAR, 0, 0, 1, expiry, TERMS);
        assertEq(agreements.agreementOf(yearlyInMonth).reserved, 10_000_083_334, "a twelfth, rounded up");
        vm.stopPrank();
        assertEq(budgets.ownCommitted(monthlyBudget), 15_000_083_334, "both in the monthly budget");
    }

    function test_GivenAFixedTermPaysLessThanThatFigure()
        external
        whenTheCallerIsAuthorised
        whenTheTermsAreValid
        whenTheReservationFits
    {
        // it should reserve only the term's pay rounded down
        uint64 endsAt = _date(2026, 1, 11);
        vm.prank(users.jordan);
        uint256 id = agreements.offer(operations, users.alice, SALARY, MONTH, 0, endsAt, MONTHLY, endsAt, TERMS);
        uint128 exact = _units(SALARY, MONTH, _now(), endsAt); // 5,000 x 10/31, rounded down
        assertEq(exact, 1_612_903_225, "ten days of January");
        assertEq(agreements.agreementOf(id).reserved, exact, "the term's exact pay");
        assertEq(budgets.ownCommitted(operations), exact, "committed in the budget");
    }
}
