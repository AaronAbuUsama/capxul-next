// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IRounds } from "../../../../src/interfaces/IRounds.sol";
import { Rounds_Shared_Test } from "../../../utils/Rounds/Rounds_Shared_Test.sol";

/// @dev `signSafe` over two note sizes against the invitation and over the signing time against `closesAt`: the
/// signed total never exceeds the invitation, each accepted note moves exactly its amount to the Safe, and Rounds
/// holds nothing.
contract SignSafe_Rounds_Unit_Fuzz_Test is Rounds_Shared_Test {
    function testFuzz_SignSafe(uint128 maxAmount, uint128 a, uint128 b, uint64 dt) external {
        maxAmount = uint128(bound(maxAmount, 1, 10_000_000 * USDC_UNIT));
        a = uint128(bound(a, 1, 2 * uint256(maxAmount)));
        b = uint128(bound(b, 1, 2 * uint256(maxAmount)));
        uint256 id = _createSafeRound(DISCOUNT);
        _inviteSafe(id, angel, maxAmount);
        uint64 closesAt = rounds.safeRound(id).closesAt;
        vm.warp(bound(dt, _now(), uint256(closesAt) + 2 days));
        bool late = _now() > closesAt;
        uint256 safeBefore = usdc.balanceOf(address(safe));

        uint128 signed;
        signed = _try(id, maxAmount, signed, a, late);
        signed = _try(id, maxAmount, signed, b, late);
        assertEq(rounds.safeInvitation(id, angel).signed, signed, "signed");
        assertLe(signed, maxAmount, "within the invitation");
        assertEq(usdc.balanceOf(address(safe)) - safeBefore, signed, "the Safe got exactly the notes");
        _assertHoldsNothing();
    }

    function _try(uint256 id, uint128 maxAmount, uint128 signed, uint128 n, bool late) private returns (uint128) {
        bool ok = !late && uint256(signed) + n <= maxAmount;
        if (late) {
            vm.expectRevert(IRounds.RoundIsClosed.selector);
        } else if (!ok) {
            vm.expectRevert(abi.encodeWithSelector(IRounds.OverInvited.selector, maxAmount - signed, n));
        }
        vm.prank(angel);
        if (!ok) {
            rounds.signSafe(id, n, ANGEL_SAFE);
            return signed;
        }
        uint256 noteId = rounds.signSafe(id, n, ANGEL_SAFE);
        assertEq(rounds.safeNote(noteId).amount, n, "note amount");
        return signed + n;
    }
}
