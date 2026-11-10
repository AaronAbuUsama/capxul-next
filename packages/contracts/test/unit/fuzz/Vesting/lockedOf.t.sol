// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { CalendarModel } from "../../../utils/Calendar/CalendarModel.sol";
import { VestingMathHarness } from "../../../utils/Vesting/VestingMathHarness.sol";
import { Vesting_Shared_Test } from "../../../utils/Vesting/Vesting_Shared_Test.sol";

/// @dev Fuzz of the lockedOf tree: any amount, any month-step schedule over six years, any time (V1, V5, V-16).
contract LockedOf_Vesting_Unit_Fuzz_Test is Vesting_Shared_Test {
    function _fuzzGrant(
        uint128 amount,
        uint256 startSeed,
        uint256 cliffSeed,
        uint256 endSeed
    )
        internal
        returns (uint128 a, uint64 start, uint64 cliff, uint64 end)
    {
        a = uint128(bound(amount, 1, AUTHORISED));
        (start, cliff, end) = _boundSchedule(startSeed, cliffSeed, endSeed);
        _grant(users.amira, a, start, cliff, end, false);
    }

    /// @dev The curve is the spec's, and locked rounds up by less than one share (V-16).
    function testFuzz_MatchesTheSchedule(
        uint128 amount,
        uint256 startSeed,
        uint256 cliffSeed,
        uint256 endSeed,
        uint64 t
    )
        external
    {
        uint64 start;
        uint64 cliff;
        uint64 end;
        (amount, start, cliff, end) = _fuzzGrant(amount, startSeed, cliffSeed, endSeed);
        t = uint64(bound(t, start > 31 days ? start - 31 days : 0, end + 31 days));
        uint128 locked = _locked(users.amira, t);
        assertEq(locked, _model(amount, start, cliff, end, t), "model");
        if (t >= cliff && t < end) {
            uint256 total = CalendarModel.monthsBetween(start, end);
            uint256 left = total - CalendarModel.monthsBetween(start, t);
            // locked == ceil(amount * left / total)
            assertGe(uint256(locked) * total, uint256(amount) * left, "rounds up");
            if (locked > 0) assertLt((uint256(locked) - 1) * total, uint256(amount) * left, "by less than one share");
        }
    }

    /// @dev V1: never increases with time.
    function testFuzz_NeverIncreases(
        uint128 amount,
        uint256 startSeed,
        uint256 cliffSeed,
        uint256 endSeed,
        uint64 t1,
        uint64 t2
    )
        external
    {
        uint64 start;
        uint64 end;
        (amount, start,, end) = _fuzzGrant(amount, startSeed, cliffSeed, endSeed);
        t1 = uint64(bound(t1, start, end + 31 days));
        t2 = uint64(bound(t2, t1, end + 31 days));
        assertGe(_locked(users.amira, t1), _locked(users.amira, t2), "locked rose");
    }

    /// @dev V1 on the formula over full-width shares and any month counts (the range the J13-bounded Halmos
    /// check `check_V1_lockedMonotone` leaves to fuzz): for `t1 <= t2` and `m1 <= m2`, locked never rises, never
    /// exceeds the amount, and rounds up by less than one share.
    function testFuzz_FormulaNeverIncreases_FullWidth(
        uint128 amount,
        uint64 cliff,
        uint64 end,
        uint64 t1,
        uint64 t2,
        uint32 m1,
        uint32 m2,
        uint32 total
    )
        external
    {
        VestingMathHarness math = new VestingMathHarness();
        cliff = uint64(bound(cliff, 0, end));
        t2 = uint64(bound(t2, t1, type(uint64).max));
        total = uint32(bound(total, cliff == end ? 0 : 1, type(uint32).max));
        m1 = uint32(bound(m1, 0, t1 >= end ? type(uint32).max : total));
        m2 = uint32(bound(m2, m1, t2 >= end ? type(uint32).max : total));
        uint128 l1 = math.exposed_scheduleLocked(amount, cliff, end, t1, m1, total);
        uint128 l2 = math.exposed_scheduleLocked(amount, cliff, end, t2, m2, total);
        assertLe(l2, l1, "locked rose");
        assertLe(l1, amount, "locked above the amount");
        if (t1 >= cliff && t1 < end) {
            // locked == ceil(amount * (total - m1) / total)
            uint256 left = uint256(total) - m1;
            assertGe(uint256(l1) * total, uint256(amount) * left, "rounds up");
            if (l1 > 0) assertLt((uint256(l1) - 1) * total, uint256(amount) * left, "by less than one share");
        }
    }

    /// @dev V5: receiving more shares of the class never changes locked.
    function testFuzz_IndependentOfTheBalance(uint128 extra, uint64 t) external {
        _defaultGrant(users.amira);
        t = uint64(bound(t, gStart, gEnd));
        uint128 before = _locked(users.amira, t);
        _issue(users.amira, uint128(bound(extra, 1, AUTHORISED - AMOUNT)));
        assertEq(_locked(users.amira, t), before, "locked moved with the balance");
    }
}
