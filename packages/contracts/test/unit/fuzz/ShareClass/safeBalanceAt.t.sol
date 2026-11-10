// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ShareClass_Fuzz_Shared } from "./ShareClass_Fuzz_Shared.sol";

/// @dev Fuzz of the safeBalanceAt tree: a Safe balance history of mints and moves out at fuzzed times,
/// read back at every step, in between, and now.
contract SafeBalanceAt_ShareClass_Unit_Fuzz_Test is ShareClass_Fuzz_Shared {
    function testFuzz_SafeBalanceAt(uint128[4] memory amounts, uint32[4] memory gaps, bool[4] memory out) external {
        uint256[4] memory at;
        uint256[4] memory expected;
        for (uint256 i; i < 4; ++i) {
            vm.warp(vm.getBlockTimestamp() + bound(gaps[i], 1, 365 days));
            uint256 balance = token.balanceOf(address(safe));
            if (out[i] && balance > 0) {
                _forcedMove(address(safe), users.alice, bound(amounts[i], 1, balance));
            } else {
                _mint(address(safe), bound(amounts[i], 1, type(uint64).max));
            }
            at[i] = vm.getBlockTimestamp();
            expected[i] = token.balanceOf(address(safe));
        }
        for (uint256 i; i < 4; ++i) {
            assertEq(token.safeBalanceAt(at[i]), expected[i], "at a step");
            assertEq(token.safeBalanceAt(at[i] - 1), i == 0 ? 0 : expected[i - 1], "just before a step");
        }
        assertEq(token.safeBalanceAt(vm.getBlockTimestamp()), token.balanceOf(address(safe)), "now");
        assertEq(token.getVotes(address(safe)), 0, "safe votes");
    }
}
