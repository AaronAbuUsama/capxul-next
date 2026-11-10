// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IGovernor as IOZGovernor } from "@openzeppelin/contracts/governance/IGovernor.sol";

import { Governor_Shared_Test } from "../../../../utils/Governor/Governor_Shared_Test.sol";

/// @dev Ruling D6 and F6: the latest snapshot of any proposal ever created; the Captable refuses issuance
/// while `block.timestamp <= pendingUntil()`.
contract PendingUntil_Governor_Unit_Concrete_Test is Governor_Shared_Test {
    function test_WhenNoProposalWasEverCreated() external {
        // it should return 0
        assertEq(governor.pendingUntil(), 0, "fresh");
        vm.warp(block.timestamp + 365 days);
        assertEq(governor.pendingUntil(), 0, "a year later");
    }

    modifier whenProposalsWereCreated() {
        _;
    }

    function test_WhenProposalsWereCreated() external whenProposalsWereCreated {
        // it should return the latest snapshot of any proposal created
        uint256 first = _propose(address(targetA), abi.encodeCall(targetA.setNumber, (1)), "first");
        assertEq(governor.pendingUntil(), governor.proposalSnapshot(first), "first snapshot");
        vm.warp(block.timestamp + 3 hours);
        uint256 second = _propose(address(targetA), abi.encodeCall(targetA.setNumber, (2)), "second");
        assertEq(governor.pendingUntil(), governor.proposalSnapshot(second), "second snapshot");
        assertEq(governor.pendingUntil(), block.timestamp + DELAY, "now plus the delay");
        // it should never decrease
        uint48 until = governor.pendingUntil();
        vm.warp(block.timestamp + 30 days);
        assertEq(governor.pendingUntil(), until, "unchanged after the window");
    }

    function test_GivenTheLatestProposalWasCancelledOrDefeated() external whenProposalsWereCreated {
        // it should still return its snapshot
        bytes memory data = abi.encodeCall(targetA.setNumber, (1));
        uint256 cancelled = _propose(address(targetA), data, "cancel me");
        uint256 snapshot = governor.proposalSnapshot(cancelled);
        vm.prank(users.amira);
        governor.cancel(_one(address(targetA)), _one(uint256(0)), _one(data), keccak256(bytes("cancel me")));
        assertEq(uint8(governor.state(cancelled)), uint8(IOZGovernor.ProposalState.Canceled), "cancelled");
        assertEq(governor.pendingUntil(), snapshot, "cancelled still counts");

        vm.warp(block.timestamp + 1);
        uint256 defeated = _propose(address(targetA), data, "defeat me");
        vm.warp(governor.proposalDeadline(defeated) + 1);
        assertEq(uint8(governor.state(defeated)), uint8(IOZGovernor.ProposalState.Defeated), "defeated");
        assertEq(governor.pendingUntil(), governor.proposalSnapshot(defeated), "defeated still counts");
    }
}
