// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IOptions } from "../../../../src/interfaces/IOptions.sol";
import { Options_Shared_Test } from "../../../utils/Options/Options_Shared_Test.sol";

/// @dev `lapse` over the time: an accepted grant lapses exactly after `expiresAt`, an ended one exactly after its
/// window, an offer exactly after `offerExpiresAt`; each returns its unexercised part (O2).
contract Lapse_Options_Unit_Fuzz_Test is Options_Shared_Test {
    function testFuzz_Lapse_Offer(uint64 dt) external {
        uint256 id = _defaultGrant();
        dt = uint64(bound(dt, 0, 2 * OFFER_WINDOW));
        vm.warp(_now() + dt);
        if (dt <= OFFER_WINDOW) {
            vm.expectRevert(IOptions.NotLapsed.selector);
            options.lapse(id);
            assertEq(options.allocated(), SHARES, "kept");
        } else {
            options.lapse(id);
            assertEq(options.allocated(), 0, "returned");
        }
    }

    function testFuzz_Lapse_Ended(uint64 endedAt, uint64 dt, uint128 exercised) external {
        uint256 id = _acceptedGrant();
        endedAt = uint64(bound(endedAt, gCliff, gEnd));
        vm.warp(endedAt);
        _end(id, endedAt);
        uint128 vested = _model(SHARES, gStart, gCliff, gEnd, 0, endedAt);
        exercised = uint128(bound(exercised, 0, vested));
        if (exercised > 0) _exercise(id, exercised);
        uint64 window = uint64(WINDOW_DAYS) * 1 days;
        dt = uint64(bound(dt, 0, 2 * window));
        vm.warp(uint256(endedAt) + dt);
        if (dt <= window) {
            vm.expectRevert(IOptions.NotLapsed.selector);
            options.lapse(id);
        } else {
            vm.expectEmit(address(options));
            emit IOptions.OptionsLapsed(id, vested - exercised);
            options.lapse(id);
            assertEq(options.allocated(), 0, "returned");
            assertEq(options.pool(), POOL - exercised, "pool fell only by the exercise");
        }
    }
}
