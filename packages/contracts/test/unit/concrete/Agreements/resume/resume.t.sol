// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IAgreements } from "../../../../../src/interfaces/IAgreements.sol";
import { CalendarModel } from "../../../../utils/Agreements/CalendarModel.sol";
import { Agreements_Unit_Shared } from "../../../../utils/Agreements/Agreements_Unit_Shared.sol";

/// @notice spec/agreements.md `resume`; invariant A3. Ports beta `PayrollDepartments.fork.t.sol:243` and
/// `PayrollDepartmentsCalendar.fork.t.sol:182` (a resume pays nothing for the paused time; a resume of a
/// running agreement is refused).
contract Resume_Agreements_Unit_Concrete_Test is Agreements_Unit_Shared {
    uint256 internal id;

    function _paused() internal returns (uint256) {
        id = _running();
        vm.prank(users.jordan);
        agreements.pause(id);
        return id;
    }

    function test_WhenACallIntoAgreementsIsAlreadyRunning() external {
        _paused();
        // it should revert with ReentrantCall
        _assertReentryRefused(abi.encodeCall(IAgreements.resume, (id)));
        assertTrue(agreements.agreementOf(id).paused, "still paused");
    }

    function test_WhenTheCallerIsNotAuthorisedForTheAgreementsBudget() external {
        _paused();
        address[3] memory outsiders = [address(users.eve), users.ben, users.alice];
        for (uint256 i; i < outsiders.length; ++i) {
            // it should revert with NotAuthorised
            vm.prank(outsiders[i]);
            vm.expectRevert(abi.encodeWithSelector(IAgreements.NotAuthorised.selector, operations, outsiders[i]));
            agreements.resume(id);
        }
    }

    function test_WhenTheAgreementIsNotPaused() external {
        id = _running();
        // it should revert with NotPaused
        vm.prank(users.jordan);
        vm.expectRevert(IAgreements.NotPaused.selector);
        agreements.resume(id);
    }

    function test_WhenItHasEnded() external {
        _paused();
        vm.prank(users.jordan);
        agreements.end(id, _now() + 1 days);
        vm.warp(_now() + 2 days);
        // it should revert with AlreadyEnded
        vm.prank(users.jordan);
        vm.expectRevert(IAgreements.AlreadyEnded.selector);
        agreements.resume(id);
    }

    function test_WhenItIsPaused() external {
        id = _stream();
        uint64 t0 = _now();
        vm.warp(t0 + 2 days);
        vm.prank(users.jordan);
        agreements.pause(id);
        vm.warp(t0 + 5 days);
        // it should emit AgreementResumed
        vm.expectEmit(address(agreements));
        emit IAgreements.AgreementResumed(address(safe), id);
        vm.prank(users.amira); // an ancestor budget's hat
        agreements.resume(id);
        assertFalse(agreements.agreementOf(id).paused, "running");
        // it should accrue again from now
        vm.warp(t0 + 7 days);
        // it should pay nothing for the paused time
        uint256 scaled = CalendarModel.pay(1000e6, WEEK, t0, t0 + 2 days)
            + CalendarModel.pay(1000e6, WEEK, t0 + 5 days, t0 + 7 days);
        assertEq(agreements.earnedOf(id), scaled / SCALE, "four of the seven days");
        assertLt(agreements.earnedOf(id), 1000e6, "less than the whole week");
    }
}
