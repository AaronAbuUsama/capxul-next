// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IGovernor as IOZGovernor } from "@openzeppelin/contracts/governance/IGovernor.sol";

import { IGovernor } from "../../../../src/interfaces/IGovernor.sol";
import { Governor_Shared_Test } from "../../../utils/Governor/Governor_Shared_Test.sol";

/// @dev G5 (R1 N-8) and the relay tree's ranged leaf. Ports Firm Voting.t.sol:152-175
/// (`testCanUpdateSettingsThroughProposals`) and 177-189 (`testSafeCantUpdateSettingsDirectly`), with OZ 5's
/// `GovernorOnlyExecutor` for Firm's queue error. Firm's 191-204 (the Governor itself outside a proposal) has
/// no OZ 5 equivalent: with no timelock the executor is the Governor, and it calls out only in `execute`.
contract Settings_Governor_Unit_Fuzz_Test is Governor_Shared_Test {
    function _setters(uint256 v) internal view returns (bytes[4] memory calls) {
        calls[0] = abi.encodeCall(governor.setVotingDelay, (uint48(bound(v, 0, type(uint48).max))));
        calls[1] = abi.encodeCall(governor.setVotingPeriod, (uint32(bound(v, 1, type(uint32).max))));
        calls[2] = abi.encodeCall(governor.setProposalThreshold, (v));
        calls[3] = abi.encodeCall(governor.updateQuorumNumerator, (bound(v, 0, 10_000)));
    }

    /// @dev Any caller but the Governor, the Safe included, is refused every setter; nothing changes.
    function testFuzz_RevertWhen_ASetterIsCalledOutsideAProposal(address caller, uint256 v, uint8 which) external {
        vm.assume(caller != address(governor));
        bytes memory call = _setters(v)[bound(which, 0, 3)];
        vm.expectRevert(abi.encodeWithSelector(IOZGovernor.GovernorOnlyExecutor.selector, caller));
        vm.prank(caller);
        (bool ok,) = address(governor).call(call);
        ok;
        vm.expectRevert(abi.encodeWithSelector(IOZGovernor.GovernorOnlyExecutor.selector, address(safe)));
        vm.prank(address(safe));
        (ok,) = address(governor).call(call);
        assertEq(governor.votingDelay(), DELAY, "delay");
        assertEq(governor.votingPeriod(), PERIOD, "period");
        assertEq(governor.proposalThreshold(), THRESHOLD, "threshold");
        assertEq(governor.quorumNumerator(), QUORUM_BPS, "numerator");
    }

    /// @dev Each setting changes by a passed proposal.
    function testFuzz_SettingsChangeByAPassedProposal(uint256 v) external {
        uint48 delay = uint48(bound(v, 1, 30 days));
        uint32 period = uint32(bound(v, 1 hours, 30 days));
        uint256 threshold = bound(v, 1, AMIRA_VOTES);
        uint256 numerator = bound(v, 1, 6000);
        _enact(address(governor), abi.encodeCall(governor.setProposalThreshold, (threshold)), "threshold");
        assertEq(governor.proposalThreshold(), threshold, "threshold");
        _enact(address(governor), abi.encodeCall(governor.updateQuorumNumerator, (numerator)), "numerator");
        assertEq(governor.quorumNumerator(), numerator, "numerator");
        _enact(address(governor), abi.encodeCall(governor.setVotingPeriod, (period)), "period");
        assertEq(governor.votingPeriod(), period, "period");
        _enact(address(governor), abi.encodeCall(governor.setVotingDelay, (delay)), "delay");
        assertEq(governor.votingDelay(), delay, "delay");
    }

    /// @dev `relay` reverts for any caller, target, value and data.
    function testFuzz_RelayAlwaysReverts(address caller, address target, uint256 value, bytes calldata data) external {
        value = bound(value, 0, 1000 ether);
        vm.deal(caller, value);
        vm.expectRevert(IGovernor.RelayDisabled.selector);
        vm.prank(caller);
        governor.relay{ value: value }(target, value, data);
    }
}
