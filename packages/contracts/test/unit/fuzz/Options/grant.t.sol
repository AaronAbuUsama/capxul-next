// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IOptions } from "../../../../src/interfaces/IOptions.sol";
import { Options_Shared_Test } from "../../../utils/Options/Options_Shared_Test.sol";

/// @dev `grant` over shares and every schedule date (dates within 2026 to 2060): accepted exactly when the
/// shares fit the pool and the schedule passes the model's checks.
contract Grant_Options_Unit_Fuzz_Test is Options_Shared_Test {
    function testFuzz_Grant_Shares(uint128 first, uint128 second) external {
        first = uint128(bound(first, 0, POOL));
        _grant(users.alice, first, gStart, gCliff, gEnd, gExpires);
        uint128 left = POOL - first;
        if (second > left) {
            vm.expectRevert(abi.encodeWithSelector(IOptions.PoolExceeded.selector, left, second));
            _grant(users.bob, second, gStart, gCliff, gEnd, gExpires);
            assertEq(options.allocated(), first, "allocated kept");
        } else {
            _grant(users.bob, second, gStart, gCliff, gEnd, gExpires);
            assertEq(options.allocated(), first + second, "allocated");
            assertLe(options.allocated(), options.pool(), "O2");
        }
    }

    function testFuzz_Grant_Schedule(uint64 start, uint64 cliff, uint64 end, uint64 expiresAt) external {
        uint64 lo = gStart;
        uint64 hi = _date(2060, 1, 1);
        start = uint64(bound(start, lo, hi));
        cliff = uint64(bound(cliff, lo, hi));
        end = uint64(bound(end, lo, hi));
        expiresAt = uint64(bound(expiresAt, lo, hi));
        if (!_validSchedule(start, cliff, end, expiresAt)) {
            vm.expectRevert(IOptions.InvalidSchedule.selector);
            _grant(users.alice, SHARES, start, cliff, end, expiresAt);
            assertEq(options.allocated(), 0, "nothing allocated");
        } else {
            uint64 offerExpiresAt = _now() + OFFER_WINDOW;
            uint256 id = _grant(users.alice, SHARES, start, cliff, end, expiresAt);
            _assertGrant(
                options.getGrant(id), _offered(users.alice, SHARES, start, cliff, end, offerExpiresAt, expiresAt)
            );
            assertEq(options.allocated(), SHARES, "allocated");
        }
    }
}
