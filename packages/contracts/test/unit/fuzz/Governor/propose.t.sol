// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IGovernor as IOZGovernor } from "@openzeppelin/contracts/governance/IGovernor.sol";

import { IGovernor } from "../../../../src/interfaces/IGovernor.sol";
import { Governor_Shared_Test } from "../../../utils/Governor/Governor_Shared_Test.sol";

/// @dev The propose tree's ranged leaves: any target outside the list (G1), any nonzero value (N-7), any
/// proposer below the threshold (G-7), and pendingUntil over any sequence of proposals (D6).
contract Propose_Governor_Unit_Fuzz_Test is Governor_Shared_Test {
    function _isAllowed(address a) internal view returns (bool) {
        address[] memory list = _allowed();
        for (uint256 i; i < list.length; ++i) {
            if (list[i] == a) return true;
        }
        return a == address(governor);
    }

    /// @dev Any address outside the list, at any of three positions among allowed calls.
    function testFuzz_RevertWhen_ATargetIsNotInTheAllowedList(address target, uint8 position) external {
        vm.assume(!_isAllowed(target));
        position = uint8(bound(position, 0, 2));
        address[] memory targets = new address[](3);
        for (uint256 i; i < 3; ++i) {
            targets[i] = i == position ? target : address(targetA);
        }
        vm.expectRevert(abi.encodeWithSelector(IGovernor.TargetNotAllowed.selector, target));
        vm.prank(users.amira);
        governor.propose(targets, new uint256[](3), new bytes[](3), "fuzz");
    }

    function testFuzz_RevertWhen_AValueIsNotZero(uint256 value, uint8 position) external {
        value = bound(value, 1, type(uint256).max);
        position = uint8(bound(position, 0, 1));
        address[] memory targets = new address[](2);
        targets[0] = address(targetA);
        targets[1] = address(targetB);
        uint256[] memory values = new uint256[](2);
        values[position] = value;
        vm.expectRevert(IGovernor.ValueNotAllowed.selector);
        vm.prank(users.amira);
        governor.propose(targets, values, new bytes[](2), "fuzz value");
    }

    /// @dev Any proposer at or above the threshold may propose; its snapshot is now plus the delay.
    function testFuzz_ProposerAtOrAboveTheThreshold(uint256 votes) external {
        votes = bound(votes, THRESHOLD, type(uint128).max);
        captable.mint(users.jordan, votes);
        vm.warp(block.timestamp + 1);
        vm.prank(users.jordan);
        uint256 id = governor.propose(_one(address(targetA)), _one(uint256(0)), _one(bytes("")), "jordan");
        assertEq(governor.proposalSnapshot(id), block.timestamp + DELAY, "snapshot");
        assertEq(governor.pendingUntil(), block.timestamp + DELAY, "pendingUntil");
    }

    /// @dev Five proposals at fuzzed gaps of up to 30 days: pendingUntil is the largest snapshot so far and
    /// never decreases.
    function testFuzz_PendingUntilIsTheLatestSnapshot(uint32[5] memory gaps) external {
        uint256 latest;
        for (uint256 i; i < 5; ++i) {
            vm.warp(block.timestamp + bound(gaps[i], 0, 30 days));
            uint48 before = governor.pendingUntil();
            uint256 id =
                _propose(address(targetA), abi.encodeCall(targetA.setNumber, (i)), string.concat("p", vm.toString(i)));
            uint256 snapshot = governor.proposalSnapshot(id);
            if (snapshot > latest) latest = snapshot;
            assertEq(governor.pendingUntil(), latest, "latest snapshot");
            assertGe(governor.pendingUntil(), before, "never decreases");
        }
    }
}
