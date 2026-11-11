// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IOptions } from "../../../../../src/interfaces/IOptions.sol";
import { Options_Shared_Test } from "../../../../utils/Options/Options_Shared_Test.sol";

/// @dev spec/options.md `lapse` (anyone); invariant O2: a lapsed grant's unexercised options leave `allocated`.
contract Lapse_Options_Unit_Concrete_Test is Options_Shared_Test {
    function test_WhenTheOfferIsStillOpenOrTheGrantIsStillExercisable() external {
        // it should revert with NotLapsed
        uint256 offered = _defaultGrant();
        vm.warp(options.getGrant(offered).offerExpiresAt); // the offer's last second
        vm.expectRevert(IOptions.NotLapsed.selector);
        vm.prank(users.eve);
        options.lapse(offered);

        uint256 id = _grant(users.bob, SHARES, gStart, gCliff, gEnd, gExpires);
        _accept(id);
        vm.warp(gExpires); // accepted, not ended, at the expiry
        vm.expectRevert(IOptions.NotLapsed.selector);
        vm.prank(users.eve);
        options.lapse(id);

        uint256 ended = _grant(users.alice, SHARES, gStart, gCliff, gEnd, gExpires + 365 days);
        _accept(ended);
        _end(ended, _now());
        vm.warp(_now() + uint64(WINDOW_DAYS) * 1 days); // the window's last second
        vm.expectRevert(IOptions.NotLapsed.selector);
        vm.prank(users.eve);
        options.lapse(ended);
    }

    function test_WhenTheOfferExpiredUnacceptedOrTheWindowOrExpiryPassed() external {
        // it should return the unexercised shares to the pool
        // it should emit OptionsLapsed
        // 1. An offer that expired unaccepted returns all its options.
        uint256 offered = _defaultGrant();
        vm.warp(options.getGrant(offered).offerExpiresAt + 1);
        vm.expectEmit(address(options));
        emit IOptions.OptionsLapsed(offered, SHARES);
        vm.prank(users.eve);
        options.lapse(offered);
        assertEq(options.allocated(), 0, "offer returned");
        assertTrue(options.getGrant(offered).cancelled, "offer gone");
        vm.expectRevert(IOptions.NotLapsed.selector);
        options.lapse(offered); // only once

        // 2. A leaver's window closes: the vested but unexercised options return.
        uint256 leaver = _grant(users.alice, SHARES, gStart, gCliff, gEnd, gExpires);
        _accept(leaver);
        vm.warp(_date(2029, 1, 1));
        _end(leaver, _now());
        _exercise(leaver, 100_000);
        vm.warp(_now() + uint64(WINDOW_DAYS) * 1 days + 1);
        vm.expectEmit(address(options));
        emit IOptions.OptionsLapsed(leaver, 12_500);
        options.lapse(leaver);
        assertEq(options.allocated(), 0, "leaver returned");
        assertEq(options.pool(), POOL - 100_000, "only the exercise left the pool");

        // 3. An accepted grant past its expiry returns everything unexercised.
        uint256 expired = _grant(users.bob, SHARES, gStart, gCliff, gEnd, gExpires);
        _accept(expired);
        vm.warp(gExpires + 1);
        vm.expectEmit(address(options));
        emit IOptions.OptionsLapsed(expired, SHARES);
        options.lapse(expired);
        assertEq(options.allocated(), 0, "expired returned");
    }
}
