// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { CalendarModel } from "../../../utils/Agreements/CalendarModel.sol";
import { Agreements_Unit_Shared } from "../../../utils/Agreements/Agreements_Unit_Shared.sol";

/// @notice `availableOf` and `earnedOf` against the model over start dates, steps and times (A1, A5),
/// including a start in the future and a mid-month start.
contract AvailableOf_Agreements_Unit_Fuzz_Test is Agreements_Unit_Shared {
    function testFuzz_MatchesTheModel(uint32 startDelay, uint32 elapsed, uint8 stepSeed, uint8 period) external {
        period = uint8(bound(period, 0, 2));
        uint64[5] memory steps = [uint64(1), 1 hours, 1 days, 7 days, MONTHLY];
        uint64 step = steps[stepSeed % 5];
        uint64 s = _now() + uint64(bound(startDelay, 0, 60 days));
        uint256 id = _offerTo(users.alice, 999e6 + 9, period, s, 0, step);
        _accept(id);
        uint64 t = _now() + uint64(bound(elapsed, 0, 500 days));
        vm.warp(t);
        if (t <= s) {
            assertEq(agreements.availableOf(id), 0, "nothing before the start");
            assertEq(agreements.earnedOf(id), 0, "nothing earned before the start");
            return;
        }
        uint256 boundary = step == MONTHLY ? CalendarModel.monthStart(t) : s + uint256(t - s) / step * step;
        if (boundary < s) boundary = s;
        assertEq(agreements.availableOf(id), CalendarModel.units(999e6 + 9, period, s, boundary), "released");
        assertEq(agreements.earnedOf(id), CalendarModel.units(999e6 + 9, period, s, t), "earned");
        assertLe(agreements.availableOf(id), agreements.earnedOf(id), "released within earned");
    }
}
