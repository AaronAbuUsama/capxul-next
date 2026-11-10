// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IOptions } from "../../../../src/interfaces/IOptions.sol";
import { Options_Shared_Test } from "../../../utils/Options/Options_Shared_Test.sol";

/// @dev `accept` over the time and the terms hash: only the exact terms, on or before `offerExpiresAt` (Q18.1).
contract Accept_Options_Unit_Fuzz_Test is Options_Shared_Test {
    function testFuzz_Accept(uint64 dt, bytes32 termsHash, bool exact) external {
        uint256 id = _defaultGrant();
        dt = uint64(bound(dt, 0, 2 * OFFER_WINDOW));
        vm.warp(_now() + dt);
        if (exact) termsHash = DOC;
        vm.prank(users.alice);
        if (dt > OFFER_WINDOW) {
            vm.expectRevert(IOptions.OfferExpired.selector);
            options.accept(id, termsHash);
        } else if (termsHash != DOC) {
            vm.expectRevert(IOptions.TermsMismatch.selector);
            options.accept(id, termsHash);
        } else {
            options.accept(id, termsHash);
            assertTrue(options.getGrant(id).accepted, "accepted");
            return;
        }
        assertFalse(options.getGrant(id).accepted, "not accepted");
    }

    function testFuzz_Accept_RevertWhen_NotTheGrantee(address caller) external {
        vm.assume(caller != users.alice);
        uint256 id = _defaultGrant();
        vm.expectRevert(IOptions.OnlyGrantee.selector);
        vm.prank(caller);
        options.accept(id, DOC);
    }
}
