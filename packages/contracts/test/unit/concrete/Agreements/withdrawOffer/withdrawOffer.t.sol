// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Vm } from "forge-std/Vm.sol";

import { IAgreements } from "../../../../../src/interfaces/IAgreements.sol";
import { Agreements_Unit_Shared } from "../../../../utils/Agreements/Agreements_Unit_Shared.sol";

/// @notice spec/agreements.md `withdrawOffer`; invariant A2. Ports beta `PayrollDepartments.fork.t.sol:447`
/// and `PayrollDepartmentsFixedTerm.fork.t.sol:172`, `:180` (only an unaccepted offer can be withdrawn;
/// it frees its budget at once).
contract WithdrawOffer_Agreements_Unit_Concrete_Test is Agreements_Unit_Shared {
    uint256 internal id;

    function test_WhenACallIntoAgreementsIsAlreadyRunning() external {
        id = _offerTo(users.bob, SALARY, MONTH, 0, 0, MONTHLY);
        // it should revert with ReentrantCall
        _assertReentryRefused(abi.encodeCall(IAgreements.withdrawOffer, (id)));
        assertFalse(agreements.agreementOf(id).closed, "the offer stands");
    }

    function test_WhenTheCallerIsNotAuthorisedForTheAgreementsBudget() external {
        id = _offer();
        address[3] memory outsiders = [address(users.eve), users.ben, users.alice];
        for (uint256 i; i < outsiders.length; ++i) {
            // it should revert with NotAuthorised
            vm.prank(outsiders[i]);
            vm.expectRevert(abi.encodeWithSelector(IAgreements.NotAuthorised.selector, operations, outsiders[i]));
            agreements.withdrawOffer(id);
        }
    }

    function test_WhenTheOfferWasAccepted() external {
        id = _running();
        // it should revert with AlreadyAccepted
        vm.prank(users.jordan);
        vm.expectRevert(IAgreements.AlreadyAccepted.selector);
        agreements.withdrawOffer(id);
    }

    function test_WhenTheOfferAlreadyExpiredOrWasWithdrawn() external {
        id = _offer();
        vm.prank(users.jordan);
        agreements.withdrawOffer(id);
        // it should revert with OfferExpired
        vm.prank(users.jordan);
        vm.expectRevert(IAgreements.OfferExpired.selector);
        agreements.withdrawOffer(id);

        uint256 lapsed = _offer();
        vm.warp(agreements.agreementOf(lapsed).offerExpiresAt);
        vm.prank(users.jordan);
        vm.expectRevert(IAgreements.OfferExpired.selector);
        agreements.withdrawOffer(lapsed);
    }

    function test_WhenTheOfferIsStanding() external {
        id = _offer();
        assertEq(budgets.ownCommitted(operations), 60_000e6, "reserved by the offer");
        vm.recordLogs();
        vm.prank(address(safe)); // the Board may withdraw too
        agreements.withdrawOffer(id);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        // it should close the agreement
        assertTrue(agreements.agreementOf(id).closed, "closed");
        // it should release its reservation in the budget
        assertEq(budgets.ownCommitted(operations), 0, "freed at once");
        // it should emit OfferWithdrawn and ReservationReleased
        assertEq(_releasedIn(logs, id), 60_000e6, "ReservationReleased");
        bool withdrawn;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == IAgreements.OfferWithdrawn.selector && uint256(logs[i].topics[2]) == id) {
                withdrawn = logs[i].emitter == address(agreements)
                    && address(uint160(uint256(logs[i].topics[1]))) == address(safe);
            }
        }
        assertTrue(withdrawn, "OfferWithdrawn(safe, id)");
    }
}
