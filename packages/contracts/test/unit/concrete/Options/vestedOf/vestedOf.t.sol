// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Options_Shared_Test } from "../../../../utils/Options/Options_Shared_Test.sol";

/// @dev spec/options.md `vestedOf`: Vesting's calendar-month formula (spec/vesting.md "The schedule", Firm
/// VestingController.t.sol:88-106 V-4 changed to month steps), frozen at `endedAt`. The leaver numbers are
/// slices/W4.md's: 36 of 48 months vests 112,500 of 150,000.
contract VestedOf_Options_Unit_Concrete_Test is Options_Shared_Test {
    function test_WhenTheTimeIsBeforeTheCliff() external {
        // it should return 0
        uint256 id = _acceptedGrant();
        assertEq(options.vestedOf(id, gStart), 0, "at the start");
        assertEq(options.vestedOf(id, gCliff - 1), 0, "one second before the cliff");
    }

    function test_WhenTheTimeIsBetweenTheCliffAndTheEnd() external {
        // it should return the shares vested by whole calendar months
        uint256 id = _acceptedGrant();
        assertEq(options.vestedOf(id, gCliff), 37_500, "12 of 48 months at the cliff");
        uint64 t = _date(2028, 7, 1);
        assertEq(options.vestedOf(id, t - 1), 90_625, "29 months the second before a step");
        assertEq(options.vestedOf(id, t), 93_750, "30 months on the step");
        assertEq(options.vestedOf(id, _date(2029, 1, 1)), 112_500, "36 months: the leaver vector");
        assertEq(options.vestedOf(id, gEnd - 1), _model(SHARES, gStart, gCliff, gEnd, 0, gEnd - 1), "47 months");
    }

    function test_WhenTheTimeIsAtOrAfterTheEnd() external {
        // it should return all the shares
        uint256 id = _acceptedGrant();
        assertEq(options.vestedOf(id, gEnd), SHARES, "at the end");
        assertEq(options.vestedOf(id, gExpires + 365 days), SHARES, "long after");
    }

    function test_GivenTheGrantWasEnded() external {
        // it should stop vesting at the end date
        uint256 id = _acceptedGrant();
        uint64 leaves = _date(2029, 1, 1);
        vm.warp(leaves);
        _end(id, leaves);
        assertEq(options.vestedOf(id, leaves), 112_500, "at the end date");
        assertEq(options.vestedOf(id, gEnd), 112_500, "frozen at the vesting end");
        assertEq(options.vestedOf(id, gExpires), 112_500, "frozen long after");
        assertEq(options.vestedOf(id, _date(2028, 1, 1)), 75_000, "before the end date unchanged");
    }
}
