// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IPayments } from "../../../../../src/interfaces/IPayments.sol";
import { IRounds } from "../../../../../src/interfaces/IRounds.sol";
import { Vm } from "forge-std/Vm.sol";
import { Rounds_Shared_Test } from "../../../../utils/Rounds/Rounds_Shared_Test.sol";

/// @dev spec/rounds.md `signSafe`: the investor's money goes to the Safe through Payments with kind 6 and the
/// investor's signed SAFE hash (one way money leaves); Rounds holds nothing. `closesAt` is the last second a note
/// can be signed. `OverInvited(max, requested)` names what the investor may still sign and what they asked for.
contract SignSafe_Rounds_Unit_Concrete_Test is Rounds_Shared_Test {
    function test_WhenTheInvestorWasNotInvited() external {
        // it should revert with NotInvited
        uint256 id = _createSafeRound(DISCOUNT);
        _expectNoPaymentOrIssue();
        vm.expectRevert(IRounds.NotInvited.selector);
        vm.prank(users.eve);
        rounds.signSafe(id, ANGEL, ANGEL_SAFE);
    }

    function test_WhenTheAmountIsMoreThanTheInvitation() external {
        // it should revert with OverInvited
        uint256 id = _createSafeRound(DISCOUNT);
        _inviteSafe(id, angel, ANGEL);
        uint256 before = usdc.balanceOf(angel);
        vm.expectRevert(abi.encodeWithSelector(IRounds.OverInvited.selector, ANGEL, ANGEL + 1));
        vm.prank(angel);
        rounds.signSafe(id, ANGEL + 1, ANGEL_SAFE);

        // Earlier notes count against the invitation.
        _signSafe(id, angel, 200_000 * 1e6, ANGEL_SAFE);
        vm.expectRevert(abi.encodeWithSelector(IRounds.OverInvited.selector, 50_000 * 1e6, 50_000 * 1e6 + 1));
        vm.prank(angel);
        rounds.signSafe(id, 50_000 * 1e6 + 1, ANGEL_SAFE);
        assertEq(before - usdc.balanceOf(angel), 200_000 * 1e6, "only the first note was paid");
        assertEq(rounds.safeInvitation(id, angel).signed, 200_000 * 1e6, "signed");

        // An invitation lowered below what is already signed leaves nothing open: OverInvited(0, n), not a panic.
        _inviteSafe(id, angel, 100_000 * 1e6);
        vm.expectRevert(abi.encodeWithSelector(IRounds.OverInvited.selector, 0, 1));
        vm.prank(angel);
        rounds.signSafe(id, 1, ANGEL_SAFE);
        assertEq(rounds.safeInvitation(id, angel).signed, 200_000 * 1e6, "nothing more signed");
    }

    function test_WhenTheRoundIsClosedOrPastItsCloseDate() external {
        // it should revert with RoundIsClosed
        uint256 id = _createSafeRound(DISCOUNT);
        _inviteSafe(id, angel, ANGEL);
        vm.prank(address(safe));
        rounds.closeSafeRound(id);
        vm.expectRevert(IRounds.RoundIsClosed.selector);
        vm.prank(angel);
        rounds.signSafe(id, ANGEL, ANGEL_SAFE);

        uint256 late = _createSafeRound(DISCOUNT);
        _inviteSafe(late, fund, FUND);
        uint64 closesAt = rounds.safeRound(late).closesAt;
        vm.warp(closesAt);
        _signSafe(late, fund, 1e6, FUND_SAFE); // the last second
        vm.warp(closesAt + 1);
        vm.expectRevert(IRounds.RoundIsClosed.selector);
        vm.prank(fund);
        rounds.signSafe(late, 1e6, FUND_SAFE);
    }

    function test_WhenTheInvitedInvestorSignsInTime() external {
        // it should pull the amount and pay it to the Safe through Payments with kind 6
        // it should hold no balance afterwards
        // it should record the SAFE note with the signed document hash
        // it should emit SafeSigned
        uint256 id = _createSafeRound(DISCOUNT);
        _inviteSafe(id, angel, ANGEL);
        uint256 angelBefore = usdc.balanceOf(angel);
        uint256 safeBefore = usdc.balanceOf(address(safe));

        // One send per note: the angel's, and the fund's below.
        vm.expectCall(address(payments), abi.encodeWithSelector(IPayments.send.selector), 2);
        vm.expectEmit(false, true, true, true, address(payments));
        emit IPayments.PaymentSent(
            bytes32(0), address(rounds), address(safe), address(usdc), ANGEL, KIND_SAFE_PURCHASE, ANGEL_SAFE
        );
        vm.recordLogs();
        uint256 noteId = _signSafe(id, angel, ANGEL, ANGEL_SAFE);

        assertEq(noteId, 1, "first note");
        assertEq(angelBefore - usdc.balanceOf(angel), ANGEL, "pulled from the investor");
        assertEq(usdc.balanceOf(address(safe)) - safeBefore, ANGEL, "paid to the Safe");
        _assertHoldsNothing();

        IRounds.SafeNote memory n = rounds.safeNote(noteId);
        assertEq(n.roundId, id, "note round");
        assertEq(n.investor, angel, "note investor");
        assertEq(n.amount, ANGEL, "note amount");
        assertEq(n.documentHash, ANGEL_SAFE, "the signed SAFE");
        assertFalse(n.converted, "not converted");
        assertEq(rounds.safeInvitation(id, angel).signed, ANGEL, "signed");

        Vm.Log memory log = _oneLog(IRounds.SafeSigned.selector);
        assertEq(uint256(log.topics[1]), id, "event round");
        assertEq(uint256(log.topics[2]), noteId, "event note");
        assertEq(address(uint160(uint256(log.topics[3]))), angel, "event investor");
        (uint128 amount, bytes32 doc, bytes32 paymentId) = abi.decode(log.data, (uint128, bytes32, bytes32));
        assertEq(amount, ANGEL, "event amount");
        assertEq(doc, ANGEL_SAFE, "event document");
        assertTrue(paymentId != bytes32(0) && payments.paid(paymentId), "event names the consumed payment");

        // A second note is a new id and a new payment.
        _inviteSafe(id, fund, FUND);
        assertEq(_signSafe(id, fund, FUND, FUND_SAFE), 2, "second note");
        assertEq(usdc.balanceOf(address(safe)) - safeBefore, uint256(ANGEL) + FUND, "both paid to the Safe");
        _assertHoldsNothing();
    }
}
