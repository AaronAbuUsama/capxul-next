// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IGovernor as IOZGovernor } from "@openzeppelin/contracts/governance/IGovernor.sol";

import { IGovernor } from "../../../../../src/interfaces/IGovernor.sol";
import { GovernorTarget } from "../../../../utils/Governor/GovernorMocks.sol";
import { Governor_Shared_Test } from "../../../../utils/Governor/Governor_Shared_Test.sol";

/// @dev Ports Firm Voting.t.sol:82-91 (G-2, without value: N-7) and 123-141 (G-3). Execution runs as the
/// Governor itself, never through the Safe (G-4 changed, G1).
contract Execute_Governor_Unit_Concrete_Test is Governor_Shared_Test {
    string internal constant DESCRIPTION = "two actions";

    function _targets() internal view returns (address[] memory list) {
        list = new address[](2);
        list[0] = address(targetA);
        list[1] = address(targetB);
    }

    function _calldatas(bool secondFails) internal view returns (bytes[] memory list) {
        list = new bytes[](2);
        list[0] = abi.encodeCall(targetA.setNumber, (7));
        list[1] = secondFails ? abi.encodeCall(targetB.refuse, ()) : abi.encodeCall(targetB.setNumber, (8));
    }

    function _proposeTwo(bool secondFails) internal returns (uint256 id) {
        vm.prank(users.amira);
        id = governor.propose(_targets(), new uint256[](2), _calldatas(secondFails), DESCRIPTION);
    }

    function test_WhenEtherIsSentWithTheCall() external {
        // it should revert with ValueNotAllowed
        uint256 id = _proposeTwo(false);
        _pass(id);
        vm.expectRevert(IGovernor.ValueNotAllowed.selector);
        vm.prank(users.eve);
        governor.execute{ value: 1 }(_targets(), new uint256[](2), _calldatas(false), keccak256(bytes(DESCRIPTION)));
        assertEq(address(governor).balance, 0, "no ether held");
        assertEq(targetA.calls(), 0, "nothing ran");
    }

    /// @dev Our `execute` override wraps OpenZeppelin's, so this leaf guards the wrapper (it must keep the
    /// state check) and the end-to-end vote: a proposal voted down, or short of the quorum (450, the Safe's
    /// shares left out), never runs.
    function test_WhenTheProposalDidNotSucceed() external {
        // it should revert with the Governor's state error
        uint256 id = _proposeTwo(false);
        vm.warp(governor.proposalSnapshot(id) + 1);
        vm.prank(users.amira);
        governor.castVote(id, AGAINST);
        vm.warp(governor.proposalDeadline(id) + 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                IOZGovernor.GovernorUnexpectedProposalState.selector,
                id,
                IOZGovernor.ProposalState.Defeated,
                _bit(IOZGovernor.ProposalState.Succeeded) | _bit(IOZGovernor.ProposalState.Queued)
            )
        );
        governor.execute(_targets(), new uint256[](2), _calldatas(false), keccak256(bytes(DESCRIPTION)));

        // Ben's 300 votes for, none against, fall short of the quorum of 450.
        bytes memory data = abi.encodeCall(targetA.setNumber, (9));
        uint256 shortId = _propose(address(targetA), data, "short of quorum");
        vm.warp(governor.proposalSnapshot(shortId) + 1);
        vm.prank(users.ben);
        governor.castVote(shortId, FOR);
        vm.warp(governor.proposalDeadline(shortId) + 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                IOZGovernor.GovernorUnexpectedProposalState.selector,
                shortId,
                IOZGovernor.ProposalState.Defeated,
                _bit(IOZGovernor.ProposalState.Succeeded) | _bit(IOZGovernor.ProposalState.Queued)
            )
        );
        _execute(address(targetA), data, "short of quorum");
        assertEq(targetA.calls(), 0, "nothing ran");
    }

    modifier whenTheProposalSucceeded() {
        _;
    }

    function test_WhenTheProposalSucceeded() external whenTheProposalSucceeded {
        uint256 id = _proposeTwo(false);
        _pass(id);
        // it should never call the Safe
        vm.expectCall(address(safe), "", 0);
        // it should emit ProposalExecuted
        vm.expectEmit(address(governor));
        emit IOZGovernor.ProposalExecuted(id);
        vm.prank(users.eve);
        uint256 executed =
            governor.execute(_targets(), new uint256[](2), _calldatas(false), keccak256(bytes(DESCRIPTION)));
        assertEq(executed, id, "id");
        // it should call each allowed target as itself
        assertEq(targetA.number(), 7, "A ran");
        assertEq(targetB.number(), 8, "B ran");
        assertEq(targetA.lastCaller(), address(governor), "A called by the Governor");
        assertEq(targetB.lastCaller(), address(governor), "B called by the Governor");
        assertEq(uint8(governor.state(id)), uint8(IOZGovernor.ProposalState.Executed), "executed");
    }

    function test_WhenAnyActionFails() external whenTheProposalSucceeded {
        // it should revert the whole execution
        uint256 id = _proposeTwo(true);
        _pass(id);
        vm.expectRevert(GovernorTarget.Refused.selector);
        governor.execute(_targets(), new uint256[](2), _calldatas(true), keccak256(bytes(DESCRIPTION)));
        assertEq(targetA.number(), 0, "first action rolled back");
        assertEq(uint8(governor.state(id)), uint8(IOZGovernor.ProposalState.Succeeded), "still succeeded");
    }
}
