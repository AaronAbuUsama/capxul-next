// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IAgreements } from "../../../../../src/interfaces/IAgreements.sol";
import { Agreements_Unit_Shared } from "../../../../utils/Agreements/Agreements_Unit_Shared.sol";

/// @notice spec/agreements.md `pause`; invariant A3. Ports beta `PayrollDepartments.fork.t.sol:208`,
/// `:243` and `PayrollDepartmentsCalendar.fork.t.sol:171` (a pause stops accrual, keeps the
/// commitment and leaves earned pay collectable; a double pause is refused; an ended agreement cannot
/// be paused).
contract Pause_Agreements_Unit_Concrete_Test is Agreements_Unit_Shared {
    uint256 internal id;

    function test_WhenACallIntoAgreementsIsAlreadyRunning() external {
        id = _running();
        // it should revert with ReentrantCall
        _assertReentryRefused(abi.encodeCall(IAgreements.pause, (id)));
        assertFalse(agreements.agreementOf(id).paused, "not paused");
    }

    function test_WhenTheCallerIsNotAuthorisedForTheAgreementsBudget() external {
        id = _running();
        address[3] memory outsiders = [address(users.eve), users.ben, users.alice];
        for (uint256 i; i < outsiders.length; ++i) {
            // it should revert with NotAuthorised
            vm.prank(outsiders[i]);
            vm.expectRevert(abi.encodeWithSelector(IAgreements.NotAuthorised.selector, operations, outsiders[i]));
            agreements.pause(id);
        }
    }

    function test_WhenTheAgreementIsNotAccepted() external {
        id = _offer();
        // it should revert with NotAccepted
        vm.prank(users.jordan);
        vm.expectRevert(IAgreements.NotAccepted.selector);
        agreements.pause(id);
    }

    function test_WhenItIsAlreadyPaused() external {
        id = _running();
        vm.prank(users.jordan);
        agreements.pause(id);
        // it should revert with AlreadyPaused
        vm.prank(users.jordan);
        vm.expectRevert(IAgreements.AlreadyPaused.selector);
        agreements.pause(id);
    }

    function test_WhenItHasEnded() external {
        id = _running();
        vm.prank(users.jordan);
        agreements.end(id, _now() + 1 days);
        vm.warp(_now() + 2 days);
        // it should revert with AlreadyEnded
        vm.prank(users.jordan);
        vm.expectRevert(IAgreements.AlreadyEnded.selector);
        agreements.pause(id);
    }

    function test_WhenItIsRunning() external {
        id = _stream();
        uint64 t0 = _now();
        vm.warp(t0 + 2 days);
        // it should emit AgreementPaused
        vm.expectEmit(address(agreements));
        emit IAgreements.AgreementPaused(address(safe), id);
        vm.prank(users.jordan);
        agreements.pause(id);
        // it should accrue to now and then stop accrual
        IAgreements.Agreement memory a = agreements.agreementOf(id);
        assertTrue(a.paused, "paused");
        assertEq(a.accruedAt, t0 + 2 days, "brought up to date");
        uint128 earned = _units(1000e6, WEEK, t0, t0 + 2 days);
        vm.warp(t0 + 30 days);
        assertEq(agreements.earnedOf(id), earned, "nothing earned while paused");
        // it should keep earned pay collectable
        assertEq(agreements.availableOf(id), earned, "the two days are collectable");
        vm.prank(users.alice);
        agreements.collect(id, earned);
        // it should keep the reservation
        assertEq(agreements.agreementOf(id).reserved, 53_000e6, "reservation kept");
        assertEq(budgets.ownCommitted(operations), 53_000e6, "budget kept");
    }
}
