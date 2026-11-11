// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ShareClass_Shared_Test } from "../../../../utils/ShareClass/ShareClass_Shared_Test.sol";

/// @dev Firm used block numbers (G-11); v4 votes on the timestamp clock.
contract Clock_ShareClass_Unit_Concrete_Test is ShareClass_Shared_Test {
    function test_ShouldReturnTheBlockTimestamp() external {
        // it should return the block timestamp
        assertEq(token.clock(), vm.getBlockTimestamp(), "now");
        vm.warp(vm.getBlockTimestamp() + 365 days);
        vm.roll(block.number + 1);
        assertEq(token.clock(), vm.getBlockTimestamp(), "a year later");
    }

    function test_ShouldReportTheTimestampClockMode() external {
        // it should report the timestamp clock mode
        assertEq(token.CLOCK_MODE(), "mode=timestamp", "clock mode");
        vm.warp(vm.getBlockTimestamp() + 1 days);
        assertEq(token.CLOCK_MODE(), "mode=timestamp", "clock mode is fixed");
    }
}
