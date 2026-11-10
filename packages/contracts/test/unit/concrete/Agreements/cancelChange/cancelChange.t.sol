// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IAgreements } from "../../../../../src/interfaces/IAgreements.sol";
import { Agreements_Unit_Shared } from "../../../../utils/Agreements/Agreements_Unit_Shared.sol";

/// @notice spec/agreements.md `cancelChange`. Ports beta `PayrollDepartmentsEdges.fork.t.sol:269`
/// (a lowering whose date has come cannot be cancelled) and `:289`.
contract CancelChange_Agreements_Unit_Concrete_Test is Agreements_Unit_Shared {
    uint256 internal id;

    function test_WhenACallIntoAgreementsIsAlreadyRunning() external {
        id = _running();
        vm.prank(users.jordan);
        agreements.changeRate(id, 3000e6, _now() + 10 days);
        // it should revert with ReentrantCall
        _assertReentryRefused(abi.encodeCall(IAgreements.cancelChange, (id)));
        assertEq(agreements.agreementOf(id).pendingRate, 3000e6, "the lowering still waits");
    }

    function test_WhenTheCallerIsNotAuthorisedForTheAgreementsBudget() external {
        id = _running();
        address[2] memory outsiders = [address(users.eve), users.ben];
        for (uint256 i; i < outsiders.length; ++i) {
            // it should revert with NotAuthorised
            vm.prank(outsiders[i]);
            vm.expectRevert(abi.encodeWithSelector(IAgreements.NotAuthorised.selector, operations, outsiders[i]));
            agreements.cancelChange(id);
        }
    }

    function test_WhenTheAgreementIsNotAccepted() external {
        id = _offer();
        // it should revert with NotAccepted
        vm.prank(users.jordan);
        vm.expectRevert(IAgreements.NotAccepted.selector);
        agreements.cancelChange(id);
    }

    function test_WhenTheAgreementIsClosed() external {
        id = _running();
        vm.prank(users.jordan);
        agreements.end(id, _now()); // ends and closes now
        // it should revert with AlreadyEnded
        vm.prank(users.jordan);
        vm.expectRevert(IAgreements.AlreadyEnded.selector);
        agreements.cancelChange(id);
    }

    function test_WhenNoLoweringIsPending() external {
        id = _running();
        // it should revert with NoPendingChange
        vm.prank(users.jordan);
        vm.expectRevert(IAgreements.NoPendingChange.selector);
        agreements.cancelChange(id);
    }

    function test_WhenTheLoweringsDateHasAlreadyCome() external {
        id = _running();
        uint64 effectiveAt = _now() + 10 days;
        vm.prank(users.jordan);
        agreements.changeRate(id, 3000e6, effectiveAt);
        vm.warp(effectiveAt);
        // it should revert with NoPendingChange because the lowering took effect
        vm.prank(users.jordan);
        vm.expectRevert(IAgreements.NoPendingChange.selector);
        agreements.cancelChange(id);
        // The refused call changed nothing; the next settle applies the lowering, which stands.
        vm.prank(users.eve);
        agreements.settle(operations);
        IAgreements.Agreement memory a = agreements.agreementOf(id);
        assertEq(a.rate, 3000e6, "the lowered rate stands");
        assertEq(a.pendingAt, 0, "nothing pending");
    }

    function test_WhenALoweringWaitsForItsDate() external {
        id = _running();
        uint64 t0 = _now();
        vm.prank(users.jordan);
        agreements.changeRate(id, 3000e6, t0 + 10 days);
        vm.warp(t0 + 5 days);
        // it should emit RateChangeCancelled
        vm.expectEmit(address(agreements));
        emit IAgreements.RateChangeCancelled(address(safe), id);
        vm.prank(users.amira); // an ancestor budget's hat may act too
        agreements.cancelChange(id);
        // it should clear it and keep the rate and the reservation
        IAgreements.Agreement memory a = agreements.agreementOf(id);
        assertEq(a.pendingAt, 0, "no pending date");
        assertEq(a.pendingRate, 0, "no pending rate");
        assertEq(a.rate, SALARY, "the rate is kept");
        assertEq(a.reserved, 60_000e6, "the reservation is kept");
        assertEq(budgets.ownCommitted(operations), 60_000e6, "the budget still holds it");
        vm.warp(t0 + 20 days);
        assertEq(agreements.earnedOf(id), _units(SALARY, MONTH, t0, t0 + 20 days), "the old rate throughout");
    }
}
