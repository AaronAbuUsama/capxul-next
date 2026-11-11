// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { CalendarModel } from "../../../utils/Agreements/CalendarModel.sol";
import { Agreements_Unit_Shared } from "../../../utils/Agreements/Agreements_Unit_Shared.sol";

/// @notice `pause` and `resume` over durations (A3): nothing is earned while paused.
contract Pause_Agreements_Unit_Fuzz_Test is Agreements_Unit_Shared {
    function testFuzz_NothingIsEarnedWhilePaused(
        uint32 before,
        uint32 pausedFor,
        uint32 afterwards,
        uint8 period
    )
        external
    {
        period = uint8(bound(period, 0, 2));
        uint128 rate = 4321e6 + 1;
        uint64 t0 = _now();
        uint256 id = _offerTo(users.alice, rate, period, 0, 0, 1);
        _accept(id);
        uint64 p = t0 + uint64(bound(before, 0, 200 days));
        uint64 r = p + uint64(bound(pausedFor, 0, 200 days));
        uint64 t = r + uint64(bound(afterwards, 0, 200 days));
        vm.warp(p);
        vm.prank(users.jordan);
        agreements.pause(id);
        vm.warp(r);
        assertEq(agreements.earnedOf(id), _units(rate, period, t0, p), "frozen while paused");
        vm.prank(users.jordan);
        agreements.resume(id);
        vm.warp(t);
        uint256 scaled = CalendarModel.pay(rate, period, t0, p) + CalendarModel.pay(rate, period, r, t);
        assertEq(agreements.earnedOf(id), scaled / SCALE, "everything but the paused time");
    }
}
