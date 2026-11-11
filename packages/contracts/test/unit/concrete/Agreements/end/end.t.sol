// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IAgreements } from "../../../../../src/interfaces/IAgreements.sol";
import { Agreements_Unit_Shared } from "../../../../utils/Agreements/Agreements_Unit_Shared.sol";

/// @notice spec/agreements.md `end`; invariants A3, A10. Ports beta `PayrollDepartments.fork.t.sol:76`,
/// `:658` and `PayrollDepartmentsFixedTerm.fork.t.sol:149` (an end only moves earlier; nothing accrues
/// after it; the whole reservation is freed at the end date).
contract End_Agreements_Unit_Concrete_Test is Agreements_Unit_Shared {
    uint256 internal id;
    uint64 internal t0;

    function test_WhenACallIntoAgreementsIsAlreadyRunning() external {
        id = _running();
        // it should revert with ReentrantCall
        _assertReentryRefused(abi.encodeCall(IAgreements.end, (id, _now() + 30 days)));
        assertEq(agreements.agreementOf(id).endsAt, 0, "still open-ended");
    }

    function test_WhenTheCallerIsNotAuthorisedForTheAgreementsBudget() external {
        id = _running();
        address[3] memory outsiders = [address(users.eve), users.ben, users.alice];
        for (uint256 i; i < outsiders.length; ++i) {
            // it should revert with NotAuthorised
            vm.prank(outsiders[i]);
            vm.expectRevert(abi.encodeWithSelector(IAgreements.NotAuthorised.selector, operations, outsiders[i]));
            agreements.end(id, _now() + 1 days);
        }
    }

    function test_WhenTheAgreementIsNotAccepted() external {
        id = _offer();
        // it should revert with NotAccepted
        vm.prank(users.jordan);
        vm.expectRevert(IAgreements.NotAccepted.selector);
        agreements.end(id, _now() + 1 days);
    }

    function test_WhenAnEndDateIsSetAndTheNewOneIsNotEarlier() external {
        id = _running();
        t0 = _now();
        vm.prank(users.jordan);
        agreements.end(id, t0 + 30 days);
        // it should revert with AlreadyEnded
        vm.prank(users.jordan);
        vm.expectRevert(IAgreements.AlreadyEnded.selector);
        agreements.end(id, t0 + 30 days);
        vm.prank(users.jordan);
        vm.expectRevert(IAgreements.AlreadyEnded.selector);
        agreements.end(id, t0 + 40 days);

        // A fixed term's end, set by its offer, also only moves earlier.
        uint256 term = _offerTo(users.bob, SALARY, MONTH, 0, t0 + 60 days, MONTHLY);
        _accept(term);
        vm.prank(address(safe));
        vm.expectRevert(IAgreements.AlreadyEnded.selector);
        agreements.end(term, t0 + 61 days);
    }

    function test_WhenTheEndDateIsInThePast() external {
        id = _running();
        vm.warp(_now() + 5 days);
        // it should revert with InvalidDate
        vm.prank(users.jordan);
        vm.expectRevert(IAgreements.InvalidDate.selector);
        agreements.end(id, _now() - 1);
    }

    modifier whenTheEndDateIsNowOrLaterAndEarlierThanAnySetEnd() {
        id = _running(); // accepted 1 January, released monthly
        t0 = _now();
        _;
    }

    function test_WhenTheEndDateIsNowOrLaterAndEarlierThanAnySetEnd()
        external
        whenTheEndDateIsNowOrLaterAndEarlierThanAnySetEnd
    {
        uint64 endsAt = t0 + 10 days;
        // it should emit AgreementEnded
        vm.expectEmit(address(agreements));
        emit IAgreements.AgreementEnded(address(safe), id, endsAt);
        vm.prank(users.jordan);
        agreements.end(id, endsAt);
        // it should record the end date
        IAgreements.Agreement memory a = agreements.agreementOf(id);
        assertEq(a.endsAt, endsAt, "end recorded");
        assertFalse(a.closed, "open until the end");
        assertEq(a.reserved, 60_000e6, "reservation kept until the end");
        // it should keep accruing until the end date exclusive
        vm.warp(endsAt - 1);
        assertEq(agreements.earnedOf(id), _units(SALARY, MONTH, t0, endsAt - 1), "to the second before the end");
        vm.prank(users.eve);
        agreements.settle(operations);
        assertEq(budgets.ownCommitted(operations), 60_000e6, "not freed before the end");
        // it should release the reservation once the end date passes
        vm.warp(endsAt);
        vm.expectEmit(address(agreements));
        emit IAgreements.ReservationReleased(address(safe), operations, id, 60_000e6);
        vm.prank(users.eve);
        agreements.settle(operations);
        assertEq(budgets.ownCommitted(operations), 0, "freed at the end date");
        assertTrue(agreements.agreementOf(id).closed, "closed");
        vm.warp(endsAt + 20 days);
        assertEq(agreements.earnedOf(id), _units(SALARY, MONTH, t0, endsAt), "nothing after the end");
        // An earlier end is still allowed while the set one has not passed.
        uint256 other = _offerTo(users.bob, SALARY, MONTH, 0, 0, MONTHLY);
        _accept(other);
        vm.startPrank(users.jordan);
        agreements.end(other, _now() + 20 days);
        agreements.end(other, _now() + 5 days);
        vm.stopPrank();
        assertEq(agreements.agreementOf(other).endsAt, _now() + 5 days, "brought forward");
    }

    function test_GivenTheEndDateIsNow() external whenTheEndDateIsNowOrLaterAndEarlierThanAnySetEnd {
        vm.warp(_date(2026, 1, 11));
        // it should close the agreement and release all earned pay and the reservation
        vm.expectEmit(address(agreements));
        emit IAgreements.ReservationReleased(address(safe), operations, id, 60_000e6);
        vm.prank(users.jordan);
        agreements.end(id, _now());
        assertTrue(agreements.agreementOf(id).closed, "closed at once");
        assertEq(budgets.ownCommitted(operations), 0, "reservation freed");
        assertEq(agreements.availableOf(id), _units(SALARY, MONTH, t0, _now()), "the part month is released, not held");
    }
}
