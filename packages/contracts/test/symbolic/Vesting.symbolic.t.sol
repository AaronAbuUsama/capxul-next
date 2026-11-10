// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";

import { VestingMathHarness } from "../utils/Vesting/VestingMathHarness.sol";

/// @notice Halmos checks for Vesting (gate 10; fv/halmos.md rows V1 and V6). They prove the schedule formula
/// with the Calendar readings as free inputs: `m = monthsBetween(start, t)` and `M = monthsBetween(start, end)`
/// are constrained only by what Calendar guarantees (monotone in `to`; `t < end` means `m <= M`), which the
/// Calendar's own exhaustive loops prove. Each check first makes one concrete call that must return the right
/// value (the vacuity guard), so the reverting stub fails it.
contract Vesting_Symbolic is Test {
    VestingMathHarness internal harness;

    function setUp() public {
        harness = new VestingMathHarness();
    }

    /// @dev The vacuity guard: 1,200 shares, 3 of 12 months vested, 900 locked; and an acceleration of a
    /// 12-month schedule (cliff at 100) to an end of 50 with one month to it keeps the cliff at 50.
    function _guard() internal view {
        try harness.exposed_scheduleLocked(1200, 10, 100, 50, 3, 12) returns (uint128 locked) {
            assert(locked == 900);
        } catch {
            assert(false);
        }
        try harness.exposed_acceleratedSchedule(0, 100, 50, 1) returns (uint64 end, uint64 cliff) {
            assert(end == 50 && cliff == 50);
        } catch {
            assert(false);
        }
    }

    /// @dev V1: for `t1 <= t2` (so `m1 <= m2`), locked at `t2` is at most locked at `t1`, and never above the
    /// amount.
    function check_V1_lockedMonotone(
        uint128 amount,
        uint64 cliff,
        uint64 end,
        uint64 t1,
        uint64 t2,
        uint32 m1,
        uint32 m2,
        uint32 total
    )
        public
        view
    {
        _guard();
        // J13: floor division by a symbolic month count does not finish in Halmos 0.3.3 within 600 s (shares to
        // 255 with a symbolic total of 1 to 72 months, or full-width shares with a concrete total), so shares are
        // bounded to 255 and the month total is concrete: 0 (all at once, no division), 1, 12 or 48. The full
        // range is the fuzz `testFuzz_NeverIncreases` in test/unit/fuzz/Vesting/lockedOf.t.sol.
        vm.assume(amount <= type(uint8).max && (total == 0 || total == 1 || total == 12 || total == 48));
        vm.assume(cliff <= end && t1 <= t2 && m1 <= m2);
        vm.assume(total >= 1 || cliff == end);
        vm.assume(t1 >= end || m1 <= total);
        vm.assume(t2 >= end || m2 <= total);
        uint128 l1 = harness.exposed_scheduleLocked(amount, cliff, end, t1, m1, total);
        uint128 l2 = harness.exposed_scheduleLocked(amount, cliff, end, t2, m2, total);
        assert(l2 <= l1);
        assert(l1 <= amount);
    }

    /// @dev V6 (ruling D7): after an acceleration to an earlier end, the end is `max(newEnd, start)` and no later
    /// than before, the cliff no later than the end and (with a whole month) than before, and locked at every `t`
    /// is at most before.
    function check_V6_accelerateOnlyUnlocks(
        uint128 amount,
        uint64 start,
        uint64 cliff,
        uint64 end,
        uint64 newEnd,
        uint64 t,
        uint32 m,
        uint32 total,
        uint32 newTotal
    )
        public
        view
    {
        _guard();
        // J13: as in V1, shares are bounded to 255 and the month totals are concrete (0, 12 or 48 before; 0, 6
        // or 12 after); the full range is the fuzz `testFuzz_OnlyEarlierAndOnlyUnlocks` in
        // test/unit/fuzz/Vesting/accelerate.t.sol.
        vm.assume(amount <= type(uint8).max && (total == 0 || total == 12 || total == 48));
        vm.assume(newTotal == 0 || newTotal == 6 || newTotal == 12);
        vm.assume(start <= cliff && cliff <= end && newEnd < end);
        vm.assume(total >= 1 || cliff == end);
        uint64 end2 = newEnd > start ? newEnd : start;
        // monthsBetween is monotone in `to`, and 0 from `start` to itself.
        vm.assume(newTotal <= total && (end2 > start || newTotal == 0));
        vm.assume(t >= end || m <= total);
        vm.assume(t >= end2 || m <= newTotal);

        (uint64 e2, uint64 c2) = harness.exposed_acceleratedSchedule(start, cliff, newEnd, newTotal);
        assert(e2 == end2);
        assert(e2 <= end);
        assert(c2 <= e2);
        // Under one whole month the cliff is the end (all at once, D7), even if that is after the old cliff.
        // With a whole month the cliff is `min(cliff, end')`, so never later than before.
        if (newTotal == 0) assert(c2 == e2);
        else assert(c2 == (cliff < e2 ? cliff : e2) && c2 <= cliff);
        uint128 before = harness.exposed_scheduleLocked(amount, cliff, end, t, m, total);
        uint128 after_ = harness.exposed_scheduleLocked(amount, c2, e2, t, m, newTotal);
        assert(after_ <= before);
    }
}
