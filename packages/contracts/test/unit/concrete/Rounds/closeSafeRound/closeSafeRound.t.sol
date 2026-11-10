// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IRounds } from "../../../../../src/interfaces/IRounds.sol";
import { Rounds_Shared_Test } from "../../../../utils/Rounds/Rounds_Shared_Test.sol";

/// @dev spec/rounds.md `closeSafeRound` (Board only, H4): no more notes. Notes already signed stay convertible.
contract CloseSafeRound_Rounds_Unit_Concrete_Test is Rounds_Shared_Test {
    function test_WhenTheRoundDoesNotExist() external {
        // it should reject the unknown SAFE round
        vm.expectRevert(abi.encodeWithSelector(IRounds.InvalidRound.selector, "unknown SAFE round"));
        vm.prank(address(safe));
        rounds.closeSafeRound(1);
    }

    function test_WhenTheCallerIsNotTheSafe() external {
        // it should revert with OnlyBoard
        uint256 id = _createSafeRound(DISCOUNT);
        vm.expectRevert(IRounds.OnlyBoard.selector);
        vm.prank(users.eve);
        rounds.closeSafeRound(id);
        assertFalse(rounds.safeRound(id).closed, "still open");
    }

    function test_WhenTheSAFERoundIsAlreadyClosed() external {
        // it should revert with RoundIsClosed
        uint256 id = _createSafeRound(DISCOUNT);
        vm.prank(address(safe));
        rounds.closeSafeRound(id);
        vm.expectRevert(IRounds.RoundIsClosed.selector);
        vm.prank(address(safe));
        rounds.closeSafeRound(id);
    }

    function test_WhenTheSAFERoundIsOpen() external {
        // it should mark it closed
        // it should refuse any later signSafe with RoundIsClosed
        (uint256 id, uint256[] memory notes) = _preSeedNotes(DISCOUNT);
        _inviteSafe(id, users.investor, ANGEL);
        vm.expectEmit(true, true, true, true, address(rounds));
        emit IRounds.SafeRoundClosed(id);
        vm.prank(address(safe));
        rounds.closeSafeRound(id);
        assertTrue(rounds.safeRound(id).closed, "closed");

        vm.expectRevert(IRounds.RoundIsClosed.selector);
        vm.prank(users.investor);
        rounds.signSafe(id, ANGEL, ANGEL_SAFE);
        assertEq(rounds.safeNote(notes[1]).amount, FUND, "earlier notes kept");
        assertFalse(rounds.safeNote(notes[0]).converted, "earlier notes still convertible");
    }
}
