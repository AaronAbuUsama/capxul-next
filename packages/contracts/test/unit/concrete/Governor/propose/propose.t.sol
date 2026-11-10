// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IGovernor as IOZGovernor } from "@openzeppelin/contracts/governance/IGovernor.sol";

import { IGovernor } from "../../../../../src/interfaces/IGovernor.sol";
import { Governor_Shared_Test } from "../../../../utils/Governor/Governor_Shared_Test.sol";

/// @dev Allowed targets only, never the Safe or Roles (G1); no value (N-7); the threshold (R1 G-7, ports
/// Firm Voting.t.sol:206-233); the pending window (ruling D6, F6).
contract Propose_Governor_Unit_Concrete_Test is Governor_Shared_Test {
    function _refused(address target) internal {
        vm.expectRevert(abi.encodeWithSelector(IGovernor.TargetNotAllowed.selector, target));
        vm.prank(users.amira);
        governor.propose(_one(target), _one(uint256(0)), _one(bytes("")), "refused");
    }

    function test_WhenATargetIsTheCompanySafe() external {
        // it should revert with TargetNotAllowed
        _refused(address(safe));
        // Also as the second of two actions, after an allowed one.
        address[] memory targets = new address[](2);
        targets[0] = address(targetA);
        targets[1] = address(safe);
        vm.expectRevert(abi.encodeWithSelector(IGovernor.TargetNotAllowed.selector, address(safe)));
        vm.prank(users.amira);
        governor.propose(targets, new uint256[](2), new bytes[](2), "safe second");
        assertEq(governor.pendingUntil(), 0, "nothing recorded");
    }

    modifier whenATargetIsNotInTheAllowedList() {
        _;
    }

    function test_GivenTheTargetIsTheZodiacRolesModifier() external whenATargetIsNotInTheAllowedList {
        // it should revert with TargetNotAllowed
        _refused(address(roles));
    }

    function test_GivenTheTargetIsAnyOtherAddress() external whenATargetIsNotInTheAllowedList {
        // it should revert with TargetNotAllowed
        _refused(users.eve);
        _refused(address(usdc));
        _refused(address(implementation));
    }

    function test_WhenAValueIsNotZero() external {
        // it should revert with ValueNotAllowed
        vm.expectRevert(IGovernor.ValueNotAllowed.selector);
        vm.prank(users.amira);
        governor.propose(_one(address(targetA)), _one(uint256(1)), _one(bytes("")), "value");
        assertEq(governor.pendingUntil(), 0, "nothing recorded");
    }

    function test_WhenTheProposersVotesAreBelowTheThreshold() external {
        // it should revert with the Governor's threshold error
        captable.mint(users.jordan, THRESHOLD - 1);
        vm.warp(block.timestamp + 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                IOZGovernor.GovernorInsufficientProposerVotes.selector, users.jordan, THRESHOLD - 1, THRESHOLD
            )
        );
        vm.prank(users.jordan);
        governor.propose(_one(address(targetA)), _one(uint256(0)), _one(bytes("")), "below");
        // The Safe holds shares but has no votes.
        vm.expectRevert(
            abi.encodeWithSelector(IOZGovernor.GovernorInsufficientProposerVotes.selector, address(safe), 0, THRESHOLD)
        );
        vm.prank(address(safe));
        governor.propose(_one(address(targetA)), _one(uint256(0)), _one(bytes("")), "safe proposes");
    }

    modifier whenEveryTargetIsAllowedAndTheProposerHasEnoughVotes() {
        _;
    }

    function test_WhenEveryTargetIsAllowedAndTheProposerHasEnoughVotes()
        external
        whenEveryTargetIsAllowedAndTheProposerHasEnoughVotes
    {
        address[] memory targets = _one(address(targetA));
        uint256[] memory values = _one(uint256(0));
        bytes[] memory calldatas = _one(abi.encodeCall(targetA.setNumber, (1)));
        string memory description = "set one";
        uint256 expectedId = uint256(keccak256(abi.encode(targets, values, calldatas, keccak256(bytes(description)))));
        uint256 start = block.timestamp + DELAY;
        // it should emit ProposalCreated
        vm.expectEmit(address(governor));
        emit IOZGovernor.ProposalCreated(
            expectedId, users.amira, targets, values, new string[](1), calldatas, start, start + PERIOD, description
        );
        vm.prank(users.amira);
        uint256 id = governor.propose(targets, values, calldatas, description);
        assertEq(id, expectedId, "id");
        // it should snapshot votes at the proposal start
        assertEq(governor.proposalSnapshot(id), start, "snapshot");
        assertEq(governor.proposalDeadline(id), start + PERIOD, "deadline");
        // it should raise pendingUntil to the proposal's snapshot
        assertEq(governor.pendingUntil(), start, "pendingUntil");
    }

    function test_GivenAnEarlierProposalsSnapshotIsLater()
        external
        whenEveryTargetIsAllowedAndTheProposerHasEnoughVotes
    {
        // it should keep pendingUntil at the later snapshot
        // A passed proposal shortens the delay; a proposal made under the old delay is still pending.
        bytes memory shorten = abi.encodeCall(governor.setVotingDelay, (1 hours));
        uint256 p0 = _propose(address(governor), shorten, "shorten the delay");
        _pass(p0);
        uint256 longOne = _propose(address(targetA), abi.encodeCall(targetA.setNumber, (1)), "long");
        uint256 longSnapshot = governor.proposalSnapshot(longOne);
        _execute(address(governor), shorten, "shorten the delay");
        assertEq(governor.votingDelay(), 1 hours, "delay shortened");
        uint256 shortOne = _propose(address(targetA), abi.encodeCall(targetA.setNumber, (2)), "short");
        assertLt(governor.proposalSnapshot(shortOne), longSnapshot, "later proposal snapshots earlier");
        assertEq(governor.pendingUntil(), longSnapshot, "kept at the later snapshot");
    }
}
