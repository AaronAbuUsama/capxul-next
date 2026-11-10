// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IGovernor as IOZGovernor } from "@openzeppelin/contracts/governance/IGovernor.sol";

import { Governor_Shared_Test } from "../../../../utils/Governor/Governor_Shared_Test.sol";

/// @dev Votes are read at the snapshot (R1 G-10, E5); the Safe's shares carry no votes (D5).
contract CastVote_Governor_Unit_Concrete_Test is Governor_Shared_Test {
    uint256 internal id;

    function setUp() public override {
        super.setUp();
        try this.proposeForSetUp() returns (uint256 proposalId) {
            id = proposalId;
        } catch { }
    }

    /// @dev External so `setUp` can survive the stub's revert; every test then fails on its own call.
    function proposeForSetUp() external returns (uint256) {
        return _propose(address(targetA), abi.encodeCall(targetA.setNumber, (1)), "vote");
    }

    modifier whenTheProposalIsActive() {
        vm.warp(governor.proposalSnapshot(id) + 1);
        assertEq(uint8(governor.state(id)), uint8(IOZGovernor.ProposalState.Active), "active");
        _;
    }

    function test_WhenTheProposalIsActive() external whenTheProposalIsActive {
        // it should count the voter's weighted votes at the snapshot
        vm.expectEmit(address(governor));
        emit IOZGovernor.VoteCast(users.amira, id, FOR, AMIRA_VOTES, "");
        vm.prank(users.amira);
        uint256 weight = governor.castVote(id, FOR);
        assertEq(weight, AMIRA_VOTES, "weight");
        (uint256 against, uint256 forVotes, uint256 abstain) = governor.proposalVotes(id);
        assertEq(forVotes, AMIRA_VOTES, "for");
        assertEq(against + abstain, 0, "others");
        assertTrue(governor.hasVoted(id, users.amira), "hasVoted");
    }

    function test_GivenSharesWereIssuedToTheVoterAfterTheSnapshot() external whenTheProposalIsActive {
        // it should not count them
        captable.mint(users.ben, 10_000);
        captable.move(users.amira, users.ben, 500);
        vm.prank(users.ben);
        uint256 weight = governor.castVote(id, AGAINST);
        assertEq(weight, BEN_VOTES, "ben counts only his snapshot votes");
        (uint256 against,,) = governor.proposalVotes(id);
        assertEq(against, BEN_VOTES, "against");
        // Amira still votes her snapshot weight although she moved shares away after it.
        vm.prank(users.amira);
        assertEq(governor.castVote(id, FOR), AMIRA_VOTES, "amira counts her snapshot votes");
    }

    function test_GivenTheVoterIsTheCompanySafe() external whenTheProposalIsActive {
        // it should count 0 votes
        vm.prank(address(safe));
        uint256 weight = governor.castVote(id, FOR);
        assertEq(weight, 0, "safe weight");
        (uint256 against, uint256 forVotes, uint256 abstain) = governor.proposalVotes(id);
        assertEq(against + forVotes + abstain, 0, "nothing counted");
    }
}
