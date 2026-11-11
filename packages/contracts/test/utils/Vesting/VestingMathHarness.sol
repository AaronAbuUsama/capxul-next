// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Vesting } from "../../../src/equity/Vesting.sol";

/// @notice Exposes Vesting's schedule maths (the Calendar readings passed in) to Halmos and the fuzz tests.
/// It changes no behaviour.
contract VestingMathHarness is Vesting {
    function exposed_lockedAt(uint256 id, uint64 t) external view returns (uint128) {
        return _lockedAt(_grants[id], t);
    }

    function exposed_scheduleLocked(
        uint128 amount,
        uint64 cliff,
        uint64 end,
        uint64 t,
        uint256 monthsToT,
        uint256 monthsToEnd
    )
        external
        pure
        returns (uint128)
    {
        return _scheduleLocked(amount, cliff, end, t, monthsToT, monthsToEnd);
    }

    function exposed_acceleratedSchedule(
        uint64 start,
        uint64 cliff,
        uint64 newEnd,
        uint256 monthsToNewEnd
    )
        external
        pure
        returns (uint64 end, uint64 cliff_)
    {
        return _acceleratedSchedule(start, cliff, newEnd, monthsToNewEnd);
    }
}
