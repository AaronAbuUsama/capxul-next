// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IAgreements } from "../../../../src/interfaces/IAgreements.sol";
import { Agreements_Unit_Shared } from "../../../utils/Agreements/Agreements_Unit_Shared.sol";

/// @notice `accept` over time (A4): accrual starts at the later of the start date and the acceptance, and
/// an acceptance at or after the expiry is refused.
contract Accept_Agreements_Unit_Fuzz_Test is Agreements_Unit_Shared {
    function testFuzz_AccrualStartsAtTheLaterOfStartAndAcceptance(uint32 startDelay, uint32 acceptDelay) external {
        uint64 t0 = _now();
        uint64 startsAt = t0 + uint64(bound(startDelay, 0, 60 days));
        uint64 expiry = t0 + 30 days;
        vm.prank(users.jordan);
        uint256 id = agreements.offer(operations, users.alice, 1000e6, WEEK, startsAt, 0, 1, expiry, TERMS);
        vm.warp(t0 + bound(acceptDelay, 0, 40 days));
        vm.prank(users.alice);
        if (_now() >= expiry) {
            vm.expectRevert(IAgreements.OfferExpired.selector);
            agreements.accept(id, TERMS);
            return;
        }
        agreements.accept(id, TERMS);
        uint64 from = startsAt > _now() ? startsAt : _now();
        assertEq(agreements.agreementOf(id).startsAt, from, "the later of the two");
        vm.warp(from + 3 days);
        assertEq(agreements.earnedOf(id), _units(1000e6, WEEK, from, from + 3 days), "three days from then");
    }

    /// @dev Any terms hash but the document's is refused.
    function testFuzz_RevertWhen_TheTermsDiffer(bytes32 termsHash) external {
        vm.assume(termsHash != TERMS);
        uint256 id = _offer();
        vm.prank(users.alice);
        vm.expectRevert(IAgreements.TermsMismatch.selector);
        agreements.accept(id, termsHash);
    }
}
