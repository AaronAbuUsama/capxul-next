// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Governor_Shared_Test } from "../../../utils/Governor/Governor_Shared_Test.sol";

/// @dev The castVote tree's ranged leaves: any votes at the snapshot count, nothing after it (E5, G-10); the
/// Safe counts 0 whatever it holds (D5).
contract CastVote_Governor_Unit_Fuzz_Test is Governor_Shared_Test {
    function testFuzz_CountsOnlyVotesAtTheSnapshot(
        uint128 atSnapshot,
        uint128 afterSnapshot,
        uint32 lateness,
        uint8 support
    )
        external
    {
        support = uint8(bound(support, 0, 2));
        if (atSnapshot > 0) captable.mint(users.jordan, atSnapshot);
        vm.warp(block.timestamp + 1);
        uint256 id = _propose(address(targetA), abi.encodeCall(targetA.setNumber, (1)), "fuzz vote");
        uint256 snapshot = governor.proposalSnapshot(id);
        // Shares issued exactly at the snapshot instant are after it only when `lateness` > 0.
        vm.warp(snapshot + 1 + bound(lateness, 0, PERIOD - 2));
        if (afterSnapshot > 0) captable.mint(users.jordan, afterSnapshot);
        vm.prank(users.jordan);
        uint256 weight = governor.castVote(id, support);
        assertEq(weight, atSnapshot, "snapshot weight");
        (uint256 against, uint256 forVotes, uint256 abstain) = governor.proposalVotes(id);
        assertEq(against + forVotes + abstain, atSnapshot, "counted");
    }

    function testFuzz_TheSafeCountsZero(uint128 safeShares, uint8 support) external {
        support = uint8(bound(support, 0, 2));
        if (safeShares > 0) captable.mint(address(safe), safeShares);
        vm.warp(block.timestamp + 1);
        uint256 id = _propose(address(targetA), abi.encodeCall(targetA.setNumber, (1)), "safe vote");
        vm.warp(governor.proposalSnapshot(id) + 1);
        vm.prank(address(safe));
        assertEq(governor.castVote(id, support), 0, "Safe weight");
    }
}
