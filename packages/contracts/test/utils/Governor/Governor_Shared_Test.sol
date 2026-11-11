// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IGovernor as IOZGovernor } from "@openzeppelin/contracts/governance/IGovernor.sol";
import { IERC5805 } from "@openzeppelin/contracts/interfaces/IERC5805.sol";
import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";

import { Governor } from "../../../src/equity/Governor.sol";
import { Base_Test } from "../../Base.t.sol";
import { GovernorTarget, MockCaptableVotes } from "./GovernorMocks.sol";

/// @notice What every Governor test shares: an implementation, a company Governor clone reading a mock
/// Captable's votes, two allowed targets, and helpers to propose, vote and execute.
///
/// Votes at `setUp`: Amira 600, Ben 300, the company Safe 100 (no votes, not in supply, ruling D5). So the
/// weighted supply without the Safe is 900, the threshold is 9 (1%), and the quorum is 450 (50%).
abstract contract Governor_Shared_Test is Base_Test {
    string internal constant NAME = "Acme Ltd Shareholders";
    uint48 internal constant DELAY = 1 days;
    uint32 internal constant PERIOD = 7 days;
    uint256 internal constant THRESHOLD = 9;
    uint256 internal constant QUORUM_BPS = 5000;
    uint256 internal constant AMIRA_VOTES = 600;
    uint256 internal constant BEN_VOTES = 300;
    uint256 internal constant SAFE_SHARES = 100;
    uint8 internal constant AGAINST = 0;
    uint8 internal constant FOR = 1;

    /// @dev OpenZeppelin `Initializable`'s error, the "initializer error" of the trees.
    bytes4 internal constant INVALID_INITIALIZATION = bytes4(keccak256("InvalidInitialization()"));

    Governor internal implementation;
    Governor internal governor;
    MockCaptableVotes internal captable;
    GovernorTarget internal targetA;
    GovernorTarget internal targetB;

    function setUp() public virtual override {
        super.setUp();
        captable = new MockCaptableVotes(address(safe));
        targetA = new GovernorTarget();
        targetB = new GovernorTarget();
        implementation = new Governor();
        governor = Governor(payable(Clones.clone(address(implementation))));
        vm.label(address(captable), "Captable");
        vm.label(address(targetA), "Target A");
        vm.label(address(targetB), "Target B");
        vm.label(address(implementation), "Governor implementation");
        vm.label(address(governor), "Governor");

        captable.mint(users.amira, AMIRA_VOTES);
        captable.mint(users.ben, BEN_VOTES);
        captable.mint(address(safe), SAFE_SHARES);

        // Red first: on the stub `initialize` reverts NotImplemented, and every test then fails on its own
        // first call into the Governor. The initialize tree asserts the initialised state explicitly.
        try governor.initialize(
            NAME, IERC5805(address(captable)), address(safe), _allowed(), DELAY, PERIOD, THRESHOLD, QUORUM_BPS
        ) { }
            catch { }
        // Votes and the quorum numerator are checkpointed now; every lookup needs a past timepoint.
        vm.warp(block.timestamp + 1);
    }

    /// @dev The company Governor's allowed targets in the tests: the Captable, Hats and two targets standing
    /// for Rounds, Exits and the Gate. Never the Safe, never Roles.
    function _allowed() internal view returns (address[] memory list) {
        list = new address[](4);
        list[0] = address(captable);
        list[1] = address(hats);
        list[2] = address(targetA);
        list[3] = address(targetB);
    }

    // ------------------------------------------------------------------ proposals

    function _one(address a) internal pure returns (address[] memory list) {
        list = new address[](1);
        list[0] = a;
    }

    function _one(uint256 v) internal pure returns (uint256[] memory list) {
        list = new uint256[](1);
        list[0] = v;
    }

    function _one(bytes memory d) internal pure returns (bytes[] memory list) {
        list = new bytes[](1);
        list[0] = d;
    }

    /// @dev Amira proposes one call with no value.
    function _propose(address target, bytes memory data, string memory description) internal returns (uint256 id) {
        vm.prank(users.amira);
        id = governor.propose(_one(target), _one(uint256(0)), _one(data), description);
    }

    /// @dev Amira votes for at the start of voting, then the clock passes the deadline.
    function _pass(uint256 id) internal {
        vm.warp(governor.proposalSnapshot(id) + 1);
        vm.prank(users.amira);
        governor.castVote(id, FOR);
        vm.warp(governor.proposalDeadline(id) + 1);
    }

    function _execute(address target, bytes memory data, string memory description) internal returns (uint256) {
        return governor.execute(_one(target), _one(uint256(0)), _one(data), keccak256(bytes(description)));
    }

    /// @dev Proposes, passes and executes one call.
    function _enact(address target, bytes memory data, string memory description) internal {
        uint256 id = _propose(target, data, description);
        _pass(id);
        _execute(target, data, description);
    }

    /// @dev OpenZeppelin's `_encodeStateBitmap`.
    function _bit(IOZGovernor.ProposalState s) internal pure returns (bytes32) {
        return bytes32(1 << uint8(s));
    }
}
