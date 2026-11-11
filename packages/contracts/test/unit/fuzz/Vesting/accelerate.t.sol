// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IVesting } from "../../../../src/interfaces/IVesting.sol";
import { CalendarModel } from "../../../utils/Calendar/CalendarModel.sol";
import { Vesting_Shared_Test } from "../../../utils/Vesting/Vesting_Shared_Test.sol";

/// @dev Fuzz of the accelerate tree (ruling D7, V6): any new end from 1970 to five years past the end, any time.
contract Accelerate_Vesting_Unit_Fuzz_Test is Vesting_Shared_Test {
    function testFuzz_OnlyEarlierAndOnlyUnlocks(uint64 newEnd, uint64 t) external {
        uint256 id = _defaultGrant(users.amira);
        newEnd = uint64(bound(newEnd, 0, gEnd + 5 * 365 days));
        t = uint64(bound(t, gStart - 31 days, gEnd + 31 days));
        if (newEnd >= gEnd) {
            vm.expectRevert(abi.encodeWithSelector(IVesting.NotEarlier.selector, gEnd, newEnd));
            _accelerate(id, newEnd, DOC2);
            return;
        }
        uint128 before = _locked(users.amira, t);
        _accelerate(id, newEnd, DOC2);
        IVesting.Grant memory g = vesting.getGrant(id);
        uint64 end = newEnd > gStart ? newEnd : gStart;
        uint64 cliff = CalendarModel.monthsBetween(gStart, end) == 0 ? end : (gCliff < end ? gCliff : end);
        assertEq(g.end, end, "end");
        assertEq(g.cliff, cliff, "cliff");
        assertEq(g.start, gStart, "start");
        assertEq(g.amount, AMOUNT, "amount");
        assertLe(_locked(users.amira, t), before, "locked rose");
        assertEq(_locked(users.amira, t), _model(AMOUNT, gStart, cliff, end, t), "new curve");
        assertEq(_balance(users.amira), AMOUNT, "no shares moved");
    }

    /// @dev V6 over any amount and any month-step schedule (the range the J13-bounded Halmos check
    /// `check_V6_accelerateOnlyUnlocks` leaves to fuzz): the stored schedule is D7's, and locked never rises.
    function testFuzz_AnyGrant_OnlyEarlierAndOnlyUnlocks(
        uint128 amount,
        uint256 startSeed,
        uint256 cliffSeed,
        uint256 endSeed,
        uint64 newEnd,
        uint64 t
    )
        external
    {
        amount = uint128(bound(amount, 1, AUTHORISED));
        (uint64 start, uint64 cliff, uint64 end) = _boundSchedule(startSeed, cliffSeed, endSeed);
        uint256 id = _grant(users.amira, amount, start, cliff, end, false);
        newEnd = uint64(bound(newEnd, start > 62 days ? start - 62 days : 0, end - 1));
        t = uint64(bound(t, start > 31 days ? start - 31 days : 0, end + 31 days));
        uint128 before = _locked(users.amira, t);
        _accelerate(id, newEnd, DOC2);
        _assertAccelerated(id, amount, start, cliff, newEnd, t, before);
    }

    /// @dev D7's stored schedule after `accelerate(newEnd)`, and locked at `t` at most `before` and on the new curve.
    function _assertAccelerated(
        uint256 id,
        uint128 amount,
        uint64 start,
        uint64 cliff,
        uint64 newEnd,
        uint64 t,
        uint128 before
    )
        internal
        view
    {
        uint64 end2 = newEnd > start ? newEnd : start;
        uint64 cliff2 = CalendarModel.monthsBetween(start, end2) == 0 ? end2 : (cliff < end2 ? cliff : end2);
        IVesting.Grant memory g = vesting.getGrant(id);
        assertEq(g.end, end2, "end");
        assertEq(g.cliff, cliff2, "cliff");
        uint128 locked = _locked(users.amira, t);
        assertLe(locked, before, "locked rose");
        assertEq(locked, _model(amount, start, cliff2, end2, t), "new curve");
    }
}
