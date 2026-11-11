// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IAgreements } from "../../../../../src/interfaces/IAgreements.sol";
import { Agreements_Unit_Shared } from "../../../../utils/Agreements/Agreements_Unit_Shared.sol";

/// @notice spec/agreements.md `accept`; invariant A4. Ports beta `PayrollDepartments.fork.t.sol:395`
/// (only the payee, exact hash, before expiry, once) and `:415` (accrual from the later of start and
/// acceptance).
contract Accept_Agreements_Unit_Concrete_Test is Agreements_Unit_Shared {
    uint256 internal id;

    function test_WhenACallIntoAgreementsIsAlreadyRunning() external {
        uint256 standing = _offerTo(users.bob, SALARY, MONTH, 0, 0, MONTHLY);
        // it should revert with ReentrantCall
        _assertReentryRefused(abi.encodeCall(IAgreements.accept, (standing, TERMS)));
        assertFalse(agreements.agreementOf(standing).accepted, "the re-entered accept did nothing");
    }

    function test_WhenTheAgreementDoesNotExist() external {
        // it should revert with InvalidAgreement
        vm.prank(users.alice);
        vm.expectRevert(IAgreements.InvalidAgreement.selector);
        agreements.accept(42, TERMS);
    }

    function test_WhenTheCallerIsNotThePayee() external {
        id = _offer();
        address[3] memory others = [address(users.eve), users.jordan, address(safe)];
        for (uint256 i; i < others.length; ++i) {
            // it should revert with NotThePayee
            vm.prank(others[i]);
            vm.expectRevert(IAgreements.NotThePayee.selector);
            agreements.accept(id, TERMS);
        }
    }

    function test_WhenItWasAlreadyAccepted() external {
        id = _running();
        // it should revert with AlreadyAccepted
        vm.prank(users.alice);
        vm.expectRevert(IAgreements.AlreadyAccepted.selector);
        agreements.accept(id, TERMS);
    }

    function test_WhenTheOfferWasWithdrawnOrHasExpired() external {
        id = _offer();
        vm.prank(users.jordan);
        agreements.withdrawOffer(id);
        // it should revert with OfferExpired
        vm.prank(users.alice);
        vm.expectRevert(IAgreements.OfferExpired.selector);
        agreements.accept(id, TERMS);

        uint256 lapsed = _offer();
        vm.warp(agreements.agreementOf(lapsed).offerExpiresAt); // expiry is exclusive
        vm.prank(users.alice);
        vm.expectRevert(IAgreements.OfferExpired.selector);
        agreements.accept(lapsed, TERMS);
    }

    function test_WhenTheTermsHashIsNotTheDocumentHash() external {
        id = _offer();
        // it should revert with TermsMismatch
        vm.prank(users.alice);
        vm.expectRevert(IAgreements.TermsMismatch.selector);
        agreements.accept(id, keccak256("other terms"));
    }

    modifier whenThePayeeAcceptsTheExactTermsInTime() {
        _;
    }

    function test_WhenThePayeeAcceptsTheExactTermsInTime() external whenThePayeeAcceptsTheExactTermsInTime {
        id = _offer();
        vm.warp(block.timestamp + 1 days);
        // it should emit AgreementAccepted
        vm.expectEmit(address(agreements));
        emit IAgreements.AgreementAccepted(address(safe), id, users.alice, _now());
        vm.prank(users.alice);
        agreements.accept(id, TERMS);
        // it should mark the agreement accepted
        assertTrue(agreements.agreementOf(id).accepted, "accepted");
        assertTrue(agreements.agreementOf(id).payee == users.alice, "the payee is unchanged");
    }

    function test_GivenTheStartDateHasPassed() external whenThePayeeAcceptsTheExactTermsInTime {
        id = _offerTo(users.alice, SALARY, MONTH, _now() + 1 days, 0, 1);
        vm.warp(block.timestamp + 3 days);
        uint64 acceptedAt = _now();
        _accept(id);
        // it should start accrual now
        IAgreements.Agreement memory a = agreements.agreementOf(id);
        assertEq(a.startsAt, acceptedAt, "starts at the acceptance");
        assertEq(a.accruedAt, acceptedAt, "checkpoint at the acceptance");
        assertEq(agreements.earnedOf(id), 0, "nothing for the days before acceptance");
        vm.warp(block.timestamp + 5 days);
        assertEq(agreements.earnedOf(id), _units(SALARY, MONTH, acceptedAt, block.timestamp), "five days' pay");
    }

    function test_GivenTheStartDateIsInTheFuture() external whenThePayeeAcceptsTheExactTermsInTime {
        uint64 startsAt = _now() + 10 days;
        id = _offerTo(users.alice, SALARY, MONTH, startsAt, 0, 1);
        _accept(id);
        // it should start accrual at the start date
        assertEq(agreements.agreementOf(id).startsAt, startsAt, "starts at the start date");
        vm.warp(startsAt - 1);
        assertEq(agreements.earnedOf(id), 0, "nothing before the start");
        vm.warp(startsAt + 3 days);
        assertEq(agreements.earnedOf(id), _units(SALARY, MONTH, startsAt, startsAt + 3 days), "three days' pay");
    }
}
