// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IVesting } from "../../../../src/interfaces/IVesting.sol";
import { Vesting_Shared_Test } from "../../../utils/Vesting/Vesting_Shared_Test.sol";

/// @dev Fuzz of the acceptGrant tree: any shareholding (FRM-05) and any moment around the offer's expiry.
contract AcceptGrant_Vesting_Unit_Fuzz_Test is Vesting_Shared_Test {
    function testFuzz_UnlockedSharesCoverTheAmount(uint128 held) external {
        held = uint128(bound(held, 0, 2 * AMOUNT));
        if (held > 0) _issue(users.ben, held);
        uint256 id = _offer(users.ben, AMOUNT);
        if (held < AMOUNT) {
            vm.expectRevert(abi.encodeWithSelector(IVesting.NotEnoughShares.selector, held, AMOUNT));
            vm.prank(users.ben);
            vesting.acceptGrant(id, DOC);
            return;
        }
        vm.prank(users.ben);
        vesting.acceptGrant(id, DOC);
        assertEq(_locked(users.ben, _now()), AMOUNT, "locked: the grant, not the balance");
    }

    function testFuzz_Expiry(uint64 wait) external {
        _issue(users.ben, AMOUNT);
        uint256 id = _offer(users.ben, AMOUNT);
        wait = uint64(bound(wait, 0, 2 * OFFER_WINDOW));
        vm.warp(_now() + wait);
        if (wait > OFFER_WINDOW) {
            vm.expectRevert(IVesting.OfferExpired.selector);
            vm.prank(users.ben);
            vesting.acceptGrant(id, DOC);
            return;
        }
        vm.prank(users.ben);
        vesting.acceptGrant(id, DOC);
        assertEq(vesting.grantOf(address(captable), COMMON, users.ben), id, "grantOf");
    }
}
