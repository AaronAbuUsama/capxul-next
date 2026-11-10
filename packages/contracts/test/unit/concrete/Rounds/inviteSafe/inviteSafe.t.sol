// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IRounds } from "../../../../../src/interfaces/IRounds.sol";
import { Rounds_Shared_Test } from "../../../../utils/Rounds/Rounds_Shared_Test.sol";

/// @dev spec/rounds.md `inviteSafe` (Board only, H4). A round past its close date counts as closed.
contract InviteSafe_Rounds_Unit_Concrete_Test is Rounds_Shared_Test {
    function test_WhenTheRoundDoesNotExist() external {
        // it should reject the unknown SAFE round
        vm.expectRevert(abi.encodeWithSelector(IRounds.InvalidRound.selector, "unknown SAFE round"));
        vm.prank(address(safe));
        rounds.inviteSafe(1, angel, ANGEL);
    }

    function test_WhenTheCallerIsNotTheSafe() external {
        // it should revert with OnlyBoard
        uint256 id = _createSafeRound(DISCOUNT);
        vm.expectRevert(IRounds.OnlyBoard.selector);
        vm.prank(users.eve);
        rounds.inviteSafe(id, users.eve, ANGEL);
        assertEq(rounds.safeInvitation(id, users.eve).maxAmount, 0, "no invitation");
    }

    function test_WhenTheSAFERoundIsClosed() external {
        // it should revert with RoundIsClosed
        uint256 id = _createSafeRound(DISCOUNT);
        vm.prank(address(safe));
        rounds.closeSafeRound(id);
        vm.expectRevert(IRounds.RoundIsClosed.selector);
        vm.prank(address(safe));
        rounds.inviteSafe(id, angel, ANGEL);

        // Past its close date, a round is closed too.
        uint256 late = _createSafeRound(DISCOUNT);
        vm.warp(rounds.safeRound(late).closesAt + 1);
        vm.expectRevert(IRounds.RoundIsClosed.selector);
        vm.prank(address(safe));
        rounds.inviteSafe(late, angel, ANGEL);
    }

    function test_WhenTheSAFERoundIsOpen() external {
        // it should record the investor's maximum
        uint256 id = _createSafeRound(DISCOUNT);
        vm.expectEmit(true, true, true, true, address(rounds));
        emit IRounds.SafeInvited(id, angel, ANGEL);
        _inviteSafe(id, angel, ANGEL);
        IRounds.SafeInvitation memory inv = rounds.safeInvitation(id, angel);
        assertEq(inv.maxAmount, ANGEL, "maximum");
        assertEq(inv.signed, 0, "nothing signed");
        assertEq(rounds.safeInvitation(id, fund).maxAmount, 0, "others not invited");

        // A second invitation replaces the maximum.
        _inviteSafe(id, angel, FUND);
        assertEq(rounds.safeInvitation(id, angel).maxAmount, FUND, "replaced");
        _assertHoldsNothing();
    }
}
