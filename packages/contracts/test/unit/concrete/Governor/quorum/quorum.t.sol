// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Votes } from "@openzeppelin/contracts/governance/utils/Votes.sol";

import { Governor_Shared_Test } from "../../../../utils/Governor/Governor_Shared_Test.sol";

/// @dev Quorum in basis points of the Captable's past weighted supply, which leaves the Safe's shares out
/// (D5, E8); the numerator is checkpointed (R1 G-6).
contract Quorum_Governor_Unit_Concrete_Test is Governor_Shared_Test {
    function test_WhenTheTimepointIsNotInThePast() external {
        // it should revert with the ERC5805 future lookup error
        uint256 now_ = block.timestamp;
        vm.expectRevert(abi.encodeWithSelector(Votes.ERC5805FutureLookup.selector, now_, uint48(now_)));
        governor.quorum(now_);
        vm.expectRevert(abi.encodeWithSelector(Votes.ERC5805FutureLookup.selector, now_ + 1, uint48(now_)));
        governor.quorum(now_ + 1);
    }

    modifier whenTheTimepointIsInThePast() {
        _;
    }

    function test_WhenTheTimepointIsInThePast() external whenTheTimepointIsInThePast {
        // it should return the quorum fraction of the Captable's past total supply
        uint256 t0 = block.timestamp - 1;
        assertEq(governor.quorum(t0), (AMIRA_VOTES + BEN_VOTES) * QUORUM_BPS / 10_000, "50% of 900");
        captable.mint(users.jordan, 1100);
        vm.warp(block.timestamp + 1);
        assertEq(governor.quorum(block.timestamp - 1), 2000 * QUORUM_BPS / 10_000, "50% of 2000");
        assertEq(governor.quorum(t0), 450, "the past is unchanged");
    }

    function test_GivenTheSafeHoldsSharesOfAVotingClass() external whenTheTimepointIsInThePast {
        // it should leave them out of the supply
        // The Safe holds 100 since setUp: with them the quorum would be 500.
        assertEq(governor.quorum(block.timestamp - 1), 450, "Safe's 100 left out");
        captable.mint(address(safe), 10_000);
        vm.warp(block.timestamp + 1);
        assertEq(governor.quorum(block.timestamp - 1), 450, "more Safe shares change nothing");
        // Shares that leave the Safe count again.
        captable.move(address(safe), users.alice, 1000);
        vm.warp(block.timestamp + 1);
        assertEq(governor.quorum(block.timestamp - 1), 950, "50% of 1900");
    }

    function test_GivenTheQuorumNumeratorChangedByAPassedProposal() external whenTheTimepointIsInThePast {
        // it should use the numerator at the timepoint
        uint256 before = block.timestamp - 1;
        _enact(address(governor), abi.encodeCall(governor.updateQuorumNumerator, (6000)), "quorum 60%");
        uint256 changedAt = block.timestamp;
        vm.warp(changedAt + 1);
        assertEq(governor.quorumNumerator(), 6000, "current numerator");
        assertEq(governor.quorumNumerator(before), QUORUM_BPS, "numerator before");
        assertEq(governor.quorum(before), 450, "old quorum before the change");
        assertEq(governor.quorum(changedAt - 1), 450, "old quorum just before the change");
        assertEq(governor.quorum(changedAt), 540, "60% of 900 from the change");
    }
}
