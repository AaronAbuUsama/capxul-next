// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IOptions } from "../../../../src/interfaces/IOptions.sol";
import { Options_Shared_Test } from "../../../utils/Options/Options_Shared_Test.sol";

/// @dev `endAllForExit` over the number of grants (1 to 16) and how many were accepted: X2, nothing stays
/// allocated or exercisable.
contract EndAllForExit_Options_Unit_Fuzz_Test is Options_Shared_Test {
    function testFuzz_EndAllForExit(uint8 count, uint16 acceptedMask) external {
        count = uint8(bound(count, 1, 16));
        uint256[] memory ids = new uint256[](count);
        for (uint256 i; i < count; ++i) {
            ids[i] = _grant(i % 2 == 0 ? users.alice : users.bob, POOL / 16, gStart, gCliff, gEnd, gExpires);
            if (uint256(acceptedMask) & (1 << i) != 0) _accept(ids[i]);
        }
        vm.warp(gEnd);
        vm.prank(exits);
        options.endAllForExit();
        assertEq(options.allocated(), 0, "nothing allocated");
        for (uint256 i; i < count; ++i) {
            assertTrue(options.getGrant(ids[i]).cancelled, "ended");
            bool accepted = uint256(acceptedMask) & (1 << i) != 0;
            address grantee = options.getGrant(ids[i]).grantee; // read before expectRevert, which takes the next call
            vm.expectRevert(accepted ? IOptions.ExerciseWindowClosed.selector : IOptions.NotAccepted.selector);
            vm.prank(grantee);
            options.exercise(ids[i], 1);
        }
    }

    /// @dev Every call ends every grant made so far: a grant made after an earlier call is ended by the next one,
    /// and the grants the earlier call ended keep their exit time.
    function testFuzz_EndAllForExit_AgainEndsLaterGrants(uint64 gap) external {
        uint256 first = _grant(users.alice, POOL / 4, gStart, gCliff, gEnd, gExpires);
        _accept(first);
        vm.warp(gEnd);
        vm.prank(exits);
        options.endAllForExit();
        uint64 firstExit = options.getGrant(first).endedAt;

        uint256 later = _grant(users.bob, POOL / 4, gStart, gCliff, gEnd, gExpires + 365 days);
        assertEq(options.allocated(), POOL / 4, "the later grant is live");
        assertFalse(options.getGrant(later).cancelled, "the later grant is not ended yet");

        vm.warp(uint256(gEnd) + bound(gap, 0, 365 days));
        vm.prank(exits);
        options.endAllForExit();
        assertEq(options.allocated(), 0, "nothing allocated");
        assertTrue(options.getGrant(later).cancelled, "the later grant ended");
        assertEq(options.getGrant(later).endedAt, _now(), "the later grant ends at the call that ended it");
        assertTrue(options.getGrant(first).cancelled, "the first grant stays ended");
        assertEq(options.getGrant(first).endedAt, firstExit, "the first grant keeps its exit time");
        vm.expectRevert(IOptions.NotLapsed.selector);
        options.lapse(later);
    }

    /// @dev O1 across a second call: a grant made, accepted and exercised after the first call is ended by the
    /// second at that call's time, so what it exercised never exceeds what it vested. (Spec: `endAllForExit` sets
    /// `endedAt` to now on grants not already ended.)
    function testFuzz_EndAllForExit_AgainKeepsO1(uint64 gap, uint128 n) external {
        vm.warp(gStart);
        vm.prank(exits);
        options.endAllForExit();

        vm.warp(uint256(gStart) + bound(gap, 1, 365 days));
        uint64 start = _now();
        uint64 end = _date(2031, 1, 1);
        uint256 later = _grant(users.bob, SHARES, start, start, end, end + 365 days);
        _accept(later);
        vm.warp(uint256(start) + 400 days);
        uint128 vested = options.vestedOf(later, _now());
        assertGt(vested, 0, "something vested");
        n = uint128(bound(n, 1, vested));
        _exercise(later, n);

        vm.prank(exits);
        options.endAllForExit();
        IOptions.OptionGrant memory g = options.getGrant(later);
        assertTrue(g.cancelled, "ended");
        assertEq(g.endedAt, _now(), "ended at the second call");
        assertLe(g.exercised, options.vestedOf(later, _now()), "O1 exercised <= vested now");
        assertLe(g.exercised, options.vestedOf(later, type(uint64).max), "O1 exercised <= vested later");
        assertEq(options.vestedOf(later, type(uint64).max), vested, "vesting frozen at the second call");
    }

    /// @dev A grant the Board ended at a future date stops vesting at the exit, not at that date: no option
    /// vests after a settled sale (X2).
    function testFuzz_EndAllForExit_CutsAFutureEndDate(uint64 dt) external {
        uint256 id = _grant(users.alice, SHARES, gStart, gCliff, gEnd, gExpires);
        _accept(id);
        vm.warp(_date(2028, 1, 1));
        uint64 endedAt = uint64(uint256(_now()) + bound(dt, 1, 3 * 365 days));
        _end(id, endedAt);
        vm.prank(exits);
        options.endAllForExit();
        IOptions.OptionGrant memory g = options.getGrant(id);
        assertTrue(g.cancelled, "ended");
        assertEq(g.endedAt, _now(), "ended at the exit");
        assertEq(options.vestedOf(id, endedAt), _model(SHARES, gStart, gCliff, gEnd, 0, _now()), "frozen at exit");
    }
}
