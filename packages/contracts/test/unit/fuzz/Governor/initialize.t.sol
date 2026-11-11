// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC5805 } from "@openzeppelin/contracts/interfaces/IERC5805.sol";
import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";

import { Governor } from "../../../../src/equity/Governor.sol";
import { IGovernor } from "../../../../src/interfaces/IGovernor.sol";
import { Governor_Shared_Test } from "../../../utils/Governor/Governor_Shared_Test.sol";

/// @dev The initialize tree's ranged leaves: the Safe at any position is refused (G1); any valid settings are
/// stored as given (G-1).
contract Initialize_Governor_Unit_Fuzz_Test is Governor_Shared_Test {
    function testFuzz_RevertWhen_TheAllowedTargetsIncludeTheCompanySafe(uint8 length, uint8 position) external {
        length = uint8(bound(length, 1, 8));
        position = uint8(bound(position, 0, length - 1));
        address[] memory targets = new address[](length);
        for (uint256 i; i < length; ++i) {
            targets[i] = i == position ? address(safe) : address(uint160(0x1000 + i));
        }
        Governor fresh = Governor(payable(Clones.clone(address(implementation))));
        vm.expectRevert(abi.encodeWithSelector(IGovernor.TargetNotAllowed.selector, address(safe)));
        fresh.initialize(
            NAME, IERC5805(address(captable)), address(safe), targets, DELAY, PERIOD, THRESHOLD, QUORUM_BPS
        );
    }

    /// @dev G1: the Governor is always its own allowed target, so a Safe equal to the Governor is refused too
    /// (Certora's `G1_safeNeverAllowed` invariant needs it).
    function test_RevertWhen_TheSafeIsTheGovernorItself() external {
        Governor fresh = Governor(payable(Clones.clone(address(implementation))));
        vm.expectRevert(abi.encodeWithSelector(IGovernor.TargetNotAllowed.selector, address(fresh)));
        fresh.initialize(
            NAME, IERC5805(address(captable)), address(fresh), _allowed(), DELAY, PERIOD, THRESHOLD, QUORUM_BPS
        );
    }

    function testFuzz_SettingsAsGiven(uint48 delay, uint32 period, uint256 threshold, uint256 numerator) external {
        period = uint32(bound(period, 1, type(uint32).max));
        numerator = bound(numerator, 0, 10_000);
        Governor fresh = Governor(payable(Clones.clone(address(implementation))));
        fresh.initialize(
            NAME, IERC5805(address(captable)), address(safe), _allowed(), delay, period, threshold, numerator
        );
        assertEq(fresh.votingDelay(), delay, "delay");
        assertEq(fresh.votingPeriod(), period, "period");
        assertEq(fresh.proposalThreshold(), threshold, "threshold");
        assertEq(fresh.quorumNumerator(), numerator, "numerator");
        assertEq(fresh.pendingUntil(), 0, "pendingUntil");
        assertTrue(fresh.isAllowedTarget(address(fresh)), "itself");
        assertFalse(fresh.isAllowedTarget(address(safe)), "not the Safe");
    }
}
