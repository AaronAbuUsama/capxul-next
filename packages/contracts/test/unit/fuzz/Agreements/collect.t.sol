// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IAgreements } from "../../../../src/interfaces/IAgreements.sol";
import { CalendarModel } from "../../../utils/Agreements/CalendarModel.sol";
import { Agreements_Unit_Shared } from "../../../utils/Agreements/Agreements_Unit_Shared.sol";

/// @notice `collect` over amounts, times and collection schedules (A1, A5, A6). Ports beta
/// `PayrollDepartments.fork.t.sol:618` and `PayrollDepartmentsCalendar.fork.t.sol:323` (fuzz: pay is
/// path-independent).
contract Collect_Agreements_Unit_Fuzz_Test is Agreements_Unit_Shared {
    /// @dev Any amount after any time up to two years: paid when within what is released, refused with the
    /// exact available figure when above it.
    function testFuzz_CollectsExactlyUpToWhatIsReleased(uint32 elapsed, uint128 amount, uint8 stepSeed) external {
        uint64[5] memory steps = [uint64(1), 1 hours, 1 days, 7 days, MONTHLY];
        uint256 id = _offerTo(users.alice, SALARY, MONTH, 0, 0, steps[stepSeed % 5]);
        _accept(id);
        vm.warp(_now() + bound(elapsed, 1, 730 days));
        uint128 available = agreements.availableOf(id);
        amount = uint128(bound(amount, 1, uint256(available) + 1000e6));
        vm.prank(users.alice);
        if (amount > available) {
            vm.expectRevert(abi.encodeWithSelector(IAgreements.InsufficientReleased.selector, available, amount));
            agreements.collect(id, amount);
            return;
        }
        agreements.collect(id, amount);
        IAgreements.Agreement memory a = agreements.agreementOf(id);
        assertEq(a.collected, amount, "collected");
        assertLe(uint256(a.collected) * SCALE, a.releasedScaled, "A1: collected within released");
        assertLe(a.releasedScaled, a.earnedScaled, "A1: released within earned");
        assertEq(agreements.availableOf(id), available - amount, "the rest stays available");
    }

    /// @dev Two identical agreements accepted together (A6): Alice's is collected at up to 12 random times,
    /// Bob's never. At the end what Alice collected plus what she can still collect equals what Bob can
    /// collect, and the same for earned pay.
    function testFuzz_PayIsPathIndependent(uint256 seed, uint8 checkpoints, uint8 stepSeed, uint8 period) external {
        period = uint8(bound(period, 0, 2));
        uint64[5] memory steps = [uint64(1), 1 hours, 1 days, 7 days, MONTHLY];
        uint64 step = steps[stepSeed % 5];
        uint128 rate = period == YEAR ? 60_007e6 + 7 : period == MONTH ? 5003e6 + 3 : 1151e6 + 1; // odd amounts
        uint256 a = _offerTo(users.alice, rate, period, 0, 0, step);
        uint256 b = _offerTo(users.bob, rate, period, 0, 0, step);
        _accept(a);
        _accept(b);
        seed = _collectAtRandomTimes(a, seed, bound(checkpoints, 1, 12));
        vm.warp(_now() + bound(seed >> 128, 0, 45 days));
        uint128 collected = agreements.agreementOf(a).collected;
        assertEq(collected + agreements.availableOf(a), agreements.availableOf(b), "released pay is the same");
        assertEq(collected + agreements.earnedOf(a), agreements.earnedOf(b), "earned pay is the same");
        assertEq(usdc.balanceOf(users.alice) - 1_000_000 * USDC_UNIT, collected, "Alice was paid what she collected");
    }

    /// @dev Warps up to 45 days `n` times and collects a random part of what is available each time.
    function _collectAtRandomTimes(uint256 id, uint256 seed, uint256 n) internal returns (uint256) {
        for (uint256 i; i < n; ++i) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            vm.warp(_now() + bound(seed, 1, 45 days));
            uint128 available = agreements.availableOf(id);
            if (available == 0) continue;
            vm.prank(users.alice);
            agreements.collect(id, uint128(bound(seed >> 64, 1, available)));
        }
        return seed;
    }

    /// @dev Released pay against the model's own calendar, for every step and period, after any time: never
    /// above the exact entitlement and short of it by less than one unit (A5).
    function testFuzz_ReleasedIsTheModelEntitlement(uint32 elapsed, uint8 stepSeed, uint8 period) external {
        period = uint8(bound(period, 0, 2));
        uint64[5] memory steps = [uint64(1), 1 hours, 1 days, 7 days, MONTHLY];
        uint64 step = steps[stepSeed % 5];
        uint64 t0 = _now();
        uint256 id = _offerTo(users.alice, 3333e6 + 3, period, 0, 0, step);
        _accept(id);
        uint64 t = t0 + uint64(bound(elapsed, 0, 730 days));
        vm.warp(t);
        uint256 boundary = step == MONTHLY ? CalendarModel.monthStart(t) : t0 + uint256(t - t0) / step * step;
        if (boundary < t0) boundary = t0;
        uint256 released = CalendarModel.pay(3333e6 + 3, period, t0, boundary);
        uint256 out = uint256(agreements.availableOf(id)) * SCALE;
        assertLe(out, released, "never more than the released entitlement");
        assertLt(released - out, SCALE, "short of it by under one unit");
        assertEq(agreements.earnedOf(id), CalendarModel.units(3333e6 + 3, period, t0, t), "earned to the unit");
    }
}
