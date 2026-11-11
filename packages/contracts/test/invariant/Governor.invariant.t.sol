// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { console2 } from "forge-std/console2.sol";

import { Governor_Shared_Test } from "../utils/Governor/Governor_Shared_Test.sol";
import { GovernorAttackerHandler } from "./handlers/GovernorAttackerHandler.sol";
import { GovernorHandler } from "./handlers/GovernorHandler.sol";

/// @notice Governor invariants E5 (votes frozen at the snapshot), G1 (never the Safe, never off the list,
/// `relay` dead), G4 (holds nothing, N-7), I3 (implementation sealed), the Governor half of E11 (D6:
/// `pendingUntil` covers every snapshot) and G5 (settings move only with passed proposals), over a company
/// Governor reading a mock Captable.
contract Governor_Invariant_Test is Governor_Shared_Test {
    GovernorHandler internal handler;
    GovernorAttackerHandler internal attacker;
    address[] internal initialTargets;

    function setUp() public override {
        super.setUp();
        address[] memory shareholders = new address[](6);
        shareholders[0] = users.amira;
        shareholders[1] = users.ben;
        shareholders[2] = users.jordan;
        shareholders[3] = users.alice;
        shareholders[4] = users.bob;
        shareholders[5] = users.investor;
        handler = new GovernorHandler(
            governor,
            captable,
            targetA,
            targetB,
            address(safe),
            shareholders,
            [uint256(DELAY), PERIOD, THRESHOLD, QUORUM_BPS]
        );
        attacker = new GovernorAttackerHandler(
            governor, implementation, users.eve, users.amira, address(safe), address(roles)
        );
        // Tried, so that on the stub each invariant reports its own NotImplemented failure.
        try governor.allowedTargets() returns (address[] memory list) {
            initialTargets = list;
        } catch { }

        targetContract(address(handler));
        // Weighted so proposals run their whole life (propose, warp past the delay, vote, warp past the
        // deadline, execute) within one run's depth; a selector listed twice is drawn twice as often.
        bytes4[] memory selectors = new bytes4[](15);
        selectors[0] = GovernorHandler.propose.selector;
        selectors[1] = GovernorHandler.propose.selector;
        selectors[2] = GovernorHandler.castVote.selector;
        selectors[3] = GovernorHandler.castVote.selector;
        selectors[4] = GovernorHandler.castVote.selector;
        selectors[5] = GovernorHandler.warp.selector;
        selectors[6] = GovernorHandler.warp.selector;
        selectors[7] = GovernorHandler.execute.selector;
        selectors[8] = GovernorHandler.execute.selector;
        selectors[9] = GovernorHandler.issue.selector;
        selectors[10] = GovernorHandler.move.selector;
        selectors[11] = GovernorHandler.castVoteAsSafe.selector;
        selectors[12] = GovernorHandler.advance.selector;
        selectors[13] = GovernorHandler.advance.selector;
        selectors[14] = GovernorHandler.advance.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
        targetContract(address(attacker));
        excludeSender(address(governor));
        excludeSender(address(implementation));
        excludeSender(address(captable));
        excludeSender(address(safe));
    }

    /// @dev E5: every counted weight equals the voter's votes at the proposal's snapshot, from the handler's own
    /// history; shares issued or moved after it never count.
    function invariant_E5_votesFrozenAtSnapshot() external view {
        assertEq(handler.ghostWrongWeights(), 0, "a weight differed from the snapshot");
        uint256 n = handler.proposalCount();
        for (uint256 i; i < n; ++i) {
            uint256 snapshot = handler.proposalSnapshot(i);
            if (snapshot >= block.timestamp) continue;
            for (uint256 k; k < handler.shareholderCount(); ++k) {
                address a = handler.shareholderAt(k);
                assertEq(governor.getVotes(a, snapshot), handler.ghostVotesAt(a, snapshot), "votes at snapshot");
            }
            assertEq(governor.getVotes(address(safe), snapshot), 0, "Safe votes at snapshot");
        }
    }

    /// @dev G1: the Safe and Roles are never allowed, the list never changes, every executed proposal called
    /// only allowed targets, and no forbidden proposal, relay or ether-carrying execute succeeded.
    function invariant_G1_neverTheSafe() external view {
        assertFalse(governor.isAllowedTarget(address(safe)), "Safe allowed");
        assertFalse(governor.isAllowedTarget(address(roles)), "Roles allowed");
        address[] memory list = governor.allowedTargets();
        assertEq(list.length, initialTargets.length, "list length");
        for (uint256 i; i < list.length; ++i) {
            assertEq(list[i], initialTargets[i], "list fixed");
        }
        uint256 n = handler.proposalCount();
        for (uint256 i; i < n; ++i) {
            if (handler.proposalExecuted(i)) assertTrue(governor.isAllowedTarget(handler.proposalTarget(i)), "target");
        }
        assertFalse(attacker.ghostEveWon(), "an attack succeeded");
    }

    /// @dev G4 (N-7): no ether, ERC-721 or ERC-1155 balance after any call.
    function invariant_G4_holdsNothing() external view {
        assertEq(address(governor).balance, 0, "ether");
        assertEq(attacker.nft721().balanceOf(address(governor)), 0, "ERC-721");
        uint256 n = attacker.sentIdCount();
        for (uint256 i; i < n; ++i) {
            assertEq(attacker.nft1155().balanceOf(address(governor), attacker.sentIds(i)), 0, "ERC-1155");
        }
        assertFalse(attacker.ghostEveWon(), "a deposit succeeded");
    }

    /// @dev G5: the settings are exactly those the executed proposals set.
    function invariant_G5_settingsOnlyByProposal() external view {
        assertEq(governor.votingDelay(), handler.ghostDelay(), "delay");
        assertEq(governor.votingPeriod(), handler.ghostPeriod(), "period");
        assertEq(governor.proposalThreshold(), handler.ghostThreshold(), "threshold");
        assertEq(governor.quorumNumerator(), handler.ghostNumerator(), "numerator");
    }

    /// @dev E11 (Governor half, D6): `pendingUntil` is the latest snapshot of any proposal ever created.
    function invariant_E11_pendingUntilCoversEverySnapshot() external view {
        assertEq(governor.pendingUntil(), handler.ghostLatestSnapshot(), "pendingUntil");
    }

    /// @dev I3: the implementation was never initialised.
    function invariant_I3_implementationSealed() external view {
        assertEq(address(implementation.token()), address(0), "implementation votes");
        assertEq(implementation.safe(), address(0), "implementation Safe");
        assertEq(implementation.allowedTargets().length, 0, "implementation targets");
    }

    function afterInvariant() external view {
        console2.log("proposals", handler.proposalCount(), "executed", handler.ghostExecuted());
        console2.log("votes counted", handler.ghostVotesCounted(), "attacks", attacker.attempts());
    }
}
