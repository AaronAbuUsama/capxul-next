// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IRounds } from "../../../../../src/interfaces/IRounds.sol";
import { Rounds_Shared_Test } from "../../../../utils/Rounds/Rounds_Shared_Test.sol";

/// @dev spec/rounds.md `cancel` (Board only, H4): only before any payment; afterwards nothing is issued in the
/// round (R3).
contract Cancel_Rounds_Unit_Concrete_Test is Rounds_Shared_Test {
    function test_WhenTheCallerIsNotTheSafe() external {
        // it should revert with OnlyBoard
        uint256 id = _defaultAllocated();
        vm.expectRevert(IRounds.OnlyBoard.selector);
        vm.prank(users.eve);
        rounds.cancel(id);
        vm.expectRevert(IRounds.OnlyBoard.selector);
        vm.prank(users.investor);
        rounds.cancel(id);
        assertFalse(rounds.pricedRound(id).cancelled, "not cancelled");
    }

    function test_WhenAnyInvestorHasPaid() external {
        // it should revert with PaymentsStarted
        uint256 id = _defaultAllocated();
        _allocated(id, angel, 1000);
        _pay(id, angel);
        vm.expectRevert(IRounds.PaymentsStarted.selector);
        vm.prank(address(safe));
        rounds.cancel(id);
        assertFalse(rounds.pricedRound(id).cancelled, "not cancelled");
        _pay(id, users.investor); // the round goes on
    }

    function test_WhenSafeNotesWereConvertedIntoTheRound() external {
        // it should revert with PaymentsStarted
        (, uint256[] memory notes) = _preSeedNotes(DISCOUNT);
        vm.prank(address(safe));
        uint256 id =
            rounds.createPricedRound(SEED, address(usdc), SEED_PRICE, MAX_SHARES, _now() + PAY_WINDOW, ROUND_DOC);
        vm.prank(address(safe));
        captable.setIssuerAllowance(address(rounds), SEED, 1_000_000);
        _convert(notes, id, CAPITALIZATION);
        assertEq(rounds.pricedRound(id).issuedShares, 0, "conversions are not round sales");
        // Shares were issued in the round's name (plan call 18): the round can no longer be cancelled.
        vm.expectRevert(IRounds.PaymentsStarted.selector);
        vm.prank(address(safe));
        rounds.cancel(id);
        assertFalse(rounds.pricedRound(id).cancelled, "not cancelled");
    }

    function test_WhenNobodyHasPaid() external {
        // it should mark the round cancelled
        // it should emit RoundCancelled
        uint256 id = _defaultAllocated();
        vm.expectEmit(true, true, true, true, address(rounds));
        emit IRounds.RoundCancelled(id);
        vm.prank(address(safe));
        rounds.cancel(id);
        assertTrue(rounds.pricedRound(id).cancelled, "cancelled");
        assertFalse(rounds.pricedRound(id).closed, "not closed");
        vm.expectRevert(IRounds.RoundIsCancelled.selector);
        vm.prank(users.investor);
        rounds.pay(id);
        _assertHoldsNothing();
    }
}
