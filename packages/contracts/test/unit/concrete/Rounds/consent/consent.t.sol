// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IRounds } from "../../../../../src/interfaces/IRounds.sol";
import { Rounds_Shared_Test } from "../../../../utils/Rounds/Rounds_Shared_Test.sol";

/// @dev spec/rounds.md `consent`: a class Governor of an earlier class whose conversion price is above the round
/// price consents to the down round for its class. Series Seed ($1.1413, Governor `seedGovernor`) is affected by a
/// round at $1.00 and not by one at $3.00. A caller that governs no class gets `NotAffected` (its class id
/// argument is left to the implementation).
contract Consent_Rounds_Unit_Concrete_Test is Rounds_Shared_Test {
    function test_WhenTheCallerIsNotAClassGovernor() external {
        // it should revert with NotAffected
        uint256 id = _createPricedRound(SERIES_C, 1_000_000, MAX_SHARES);
        vm.prank(users.eve);
        _expectSelector(abi.encodeCall(IRounds.consent, (id)), IRounds.NotAffected.selector);
        vm.prank(address(safe)); // the Board is no class Governor
        _expectSelector(abi.encodeCall(IRounds.consent, (id)), IRounds.NotAffected.selector);
        assertFalse(rounds.consented(id, SEED), "no consent");
    }

    function test_WhenTheClasssConversionPriceIsNotAboveTheRoundPrice() external {
        // it should revert with NotAffected
        uint256 id = _createPricedRound(SERIES_C, 3_000_000, MAX_SHARES);
        vm.expectRevert(abi.encodeWithSelector(IRounds.NotAffected.selector, SEED));
        vm.prank(seedGovernor);
        rounds.consent(id);
        // Equal is not above.
        uint256 flat = _createPricedRound(SERIES_C, SEED_PRICE, MAX_SHARES);
        vm.expectRevert(abi.encodeWithSelector(IRounds.NotAffected.selector, SEED));
        vm.prank(seedGovernor);
        rounds.consent(flat);
    }

    function test_WhenAnAffectedClasssGovernorConsents() external {
        // it should record the consent
        // it should emit ConsentGiven
        uint256 id = _createPricedRound(SERIES_C, 1_000_000, MAX_SHARES);
        vm.expectEmit(true, true, true, true, address(rounds));
        emit IRounds.ConsentGiven(id, SEED);
        vm.prank(seedGovernor);
        rounds.consent(id);
        assertTrue(rounds.consented(id, SEED), "consented");
        assertFalse(rounds.consented(id, SERIES_A), "only its own class");
        uint256 other = _createPricedRound(SERIES_C, 1_000_000, MAX_SHARES);
        assertFalse(rounds.consented(other, SEED), "only this round");
        _assertHoldsNothing();
    }
}
