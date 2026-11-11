// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IGovernor as IOZGovernor } from "@openzeppelin/contracts/governance/IGovernor.sol";
import { Test } from "forge-std/Test.sol";

import { Governor } from "../../../src/equity/Governor.sol";
import { GovernorTarget, MockCaptableVotes } from "../../utils/Governor/GovernorMocks.sol";

/// @notice The shareholders (founders Amira and Ben, Jordan, the hires Alice and Bob, the investor) and the
/// Board's issuance: shares are issued and moved (the Safe included), shareholders propose allowed calls and
/// setting changes, vote and execute passed proposals, and time moves. Every call is bounded to one the
/// rules allow, so a revert is a failure (`fail_on_revert`).
///
/// Ghosts: each account's votes after every change, kept here apart from the Captable's checkpoints (E5);
/// the latest snapshot of any proposal (E11, D6); the settings as passed proposals set them (G5); and any
/// counted weight that differs from the ghost at the snapshot.
contract GovernorHandler is Test {
    struct Proposal {
        address target;
        bytes data;
        string description;
        uint256 id;
        uint256 snapshot;
        bool executed;
    }

    struct Point {
        uint256 time;
        uint256 votes;
    }

    Governor internal immutable governor;
    MockCaptableVotes internal immutable captable;
    GovernorTarget internal immutable targetA;
    GovernorTarget internal immutable targetB;
    address internal immutable safe;
    address[] internal shareholders;

    Proposal[] internal proposals;
    mapping(address account => Point[] history) internal ghostVotes;

    uint256 public ghostLatestSnapshot;
    uint256 public ghostWrongWeights;
    uint256 public ghostVotesCounted;
    uint256 public ghostDelay;
    uint256 public ghostPeriod;
    uint256 public ghostThreshold;
    uint256 public ghostNumerator;
    uint256 public ghostExecuted;
    mapping(bytes4 selector => uint256 count) public calls;

    constructor(
        Governor governor_,
        MockCaptableVotes captable_,
        GovernorTarget targetA_,
        GovernorTarget targetB_,
        address safe_,
        address[] memory shareholders_,
        uint256[4] memory settings
    ) {
        governor = governor_;
        captable = captable_;
        targetA = targetA_;
        targetB = targetB_;
        safe = safe_;
        shareholders = shareholders_;
        (ghostDelay, ghostPeriod, ghostThreshold, ghostNumerator) = (settings[0], settings[1], settings[2], settings[3]);
        for (uint256 i; i < shareholders_.length; ++i) {
            _record(shareholders_[i]);
        }
    }

    // ------------------------------------------------------------------ shares (the Board, Rounds, transfers)

    function issue(uint256 actorSeed, uint256 amount) external {
        calls[this.issue.selector]++;
        address to = _actorOrSafe(actorSeed);
        captable.mint(to, bound(amount, 1, 300));
        _record(to);
    }

    function move(uint256 fromSeed, uint256 toSeed, uint256 amount) external {
        calls[this.move.selector]++;
        address from = _actorOrSafe(fromSeed);
        address to = _actorOrSafe(toSeed);
        uint256 balance = captable.balanceOf(from);
        if (balance == 0 || from == to) return;
        captable.move(from, to, bound(amount, 1, balance));
        _record(from);
        _record(to);
    }

    function warp(uint256 seconds_) external {
        calls[this.warp.selector]++;
        vm.warp(block.timestamp + bound(seconds_, 1 hours, 3 days));
    }

    /// @dev Moves a proposal to its next phase: just past its snapshot if it is Pending; if it is Active, every
    /// shareholder yet to vote who had votes at the snapshot votes (three in four for), then time moves just
    /// past its deadline; if it Succeeded, it is executed. Without it few proposals reach `execute` in a run.
    function advance(uint256 proposalSeed, uint8 support) external {
        calls[this.advance.selector]++;
        uint256 n = proposals.length;
        for (uint256 k; k < n; ++k) {
            uint256 index = (proposalSeed % n + k) % n;
            Proposal storage p = proposals[index];
            IOZGovernor.ProposalState s = governor.state(p.id);
            if (s == IOZGovernor.ProposalState.Pending) {
                vm.warp(p.snapshot + 1);
                return;
            }
            if (s == IOZGovernor.ProposalState.Active) {
                for (uint256 j; j < shareholders.length; ++j) {
                    address voter = shareholders[j];
                    if (governor.hasVoted(p.id, voter) || _ghostVotesAt(voter, p.snapshot) == 0) continue;
                    _vote(voter, index, uint8((support + j) % 4 == 0 ? 0 : 1));
                }
                vm.warp(governor.proposalDeadline(p.id) + 1);
                return;
            }
            if (s == IOZGovernor.ProposalState.Succeeded) {
                _execute(index, proposalSeed);
                return;
            }
        }
    }

    // ------------------------------------------------------------------ governance

    function propose(uint256 actorSeed, uint256 kind, uint256 value) external {
        calls[this.propose.selector]++;
        address proposer = _proposer(actorSeed);
        if (proposer == address(0)) return;
        (address target, bytes memory data) = _action(kind, value);
        string memory description = string.concat("proposal ", vm.toString(proposals.length));
        vm.prank(proposer);
        uint256 id = governor.propose(_one(target), new uint256[](1), _one(data), description);
        uint256 snapshot = governor.proposalSnapshot(id);
        proposals.push(Proposal(target, data, description, id, snapshot, false));
        if (snapshot > ghostLatestSnapshot) ghostLatestSnapshot = snapshot;
    }

    /// @dev Every shareholder with votes at the snapshot votes on a live proposal, three in four for, so most
    /// proposals pass and execute.
    function castVote(uint256 actorSeed, uint256 proposalSeed, uint8 support) external {
        calls[this.castVote.selector]++;
        uint256 n = shareholders.length;
        for (uint256 k; k < n; ++k) {
            address voter = shareholders[(actorSeed % n + k) % n];
            (bool found, uint256 index) = _find(proposalSeed, IOZGovernor.ProposalState.Active, voter);
            if (!found || _ghostVotesAt(voter, proposals[index].snapshot) == 0) continue;
            _vote(voter, index, uint8((support + k) % 4 == 0 ? 0 : 1));
        }
    }

    /// @dev The Safe votes; it must count 0 (D5).
    function castVoteAsSafe(uint256 proposalSeed, uint8 support) external {
        calls[this.castVoteAsSafe.selector]++;
        (bool found, uint256 index) = _find(proposalSeed, IOZGovernor.ProposalState.Active, safe);
        if (found) _vote(safe, index, uint8(bound(support, 0, 2)));
    }

    function _vote(address voter, uint256 index, uint8 support) internal {
        Proposal storage p = proposals[index];
        vm.prank(voter);
        uint256 weight = governor.castVote(p.id, support);
        if (weight != _ghostVotesAt(voter, p.snapshot)) ghostWrongWeights++;
        ghostVotesCounted++;
    }

    function execute(uint256 proposalSeed, uint256 callerSeed) external {
        calls[this.execute.selector]++;
        (bool found, uint256 index) = _find(proposalSeed, IOZGovernor.ProposalState.Succeeded, address(0));
        if (found) _execute(index, callerSeed);
    }

    function _execute(uint256 index, uint256 callerSeed) internal {
        Proposal storage p = proposals[index];
        vm.prank(_actorOrSafe(callerSeed));
        governor.execute(_one(p.target), new uint256[](1), _one(p.data), keccak256(bytes(p.description)));
        p.executed = true;
        ghostExecuted++;
        _applySetting(p.data);
    }

    // ------------------------------------------------------------------ views for the invariants

    function proposalCount() external view returns (uint256) {
        return proposals.length;
    }

    function proposalTarget(uint256 i) external view returns (address) {
        return proposals[i].target;
    }

    function proposalExecuted(uint256 i) external view returns (bool) {
        return proposals[i].executed;
    }

    function proposalId(uint256 i) external view returns (uint256) {
        return proposals[i].id;
    }

    function proposalSnapshot(uint256 i) external view returns (uint256) {
        return proposals[i].snapshot;
    }

    function shareholderCount() external view returns (uint256) {
        return shareholders.length;
    }

    function shareholderAt(uint256 i) external view returns (address) {
        return shareholders[i];
    }

    function ghostVotesAt(address account, uint256 time) external view returns (uint256) {
        return _ghostVotesAt(account, time);
    }

    // ------------------------------------------------------------------ internals

    function _actorOrSafe(uint256 seed) internal view returns (address) {
        uint256 i = bound(seed, 0, shareholders.length);
        return i == shareholders.length ? safe : shareholders[i];
    }

    /// @dev A shareholder whose votes one second ago meet the threshold, starting from the seed; or zero.
    function _proposer(uint256 seed) internal view returns (address) {
        uint256 threshold = governor.proposalThreshold();
        uint256 n = shareholders.length;
        for (uint256 k; k < n; ++k) {
            address a = shareholders[(seed % n + k) % n];
            if (captable.getPastVotes(a, block.timestamp - 1) >= threshold) return a;
        }
        return address(0);
    }

    /// @dev An allowed call: a target's number, or a setting change within sane bounds (G5).
    function _action(uint256 kind, uint256 value) internal view returns (address, bytes memory) {
        kind = bound(kind, 0, 5);
        if (kind == 0) return (address(targetA), abi.encodeCall(GovernorTarget.setNumber, (value)));
        if (kind == 1) return (address(targetB), abi.encodeCall(GovernorTarget.setNumber, (value)));
        if (kind == 2) {
            return (address(governor), abi.encodeCall(governor.setVotingDelay, (uint48(bound(value, 1 hours, 2 days)))));
        }
        if (kind == 3) {
            return (address(governor), abi.encodeCall(governor.setVotingPeriod, (uint32(bound(value, 1 days, 7 days)))));
        }
        if (kind == 4) {
            return (address(governor), abi.encodeCall(governor.setProposalThreshold, (bound(value, 1, 50))));
        }
        return (address(governor), abi.encodeCall(governor.updateQuorumNumerator, (bound(value, 1000, 6000))));
    }

    function _applySetting(bytes memory data) internal {
        bytes4 selector = bytes4(data);
        bytes memory args = new bytes(data.length - 4);
        for (uint256 i; i < args.length; ++i) {
            args[i] = data[i + 4];
        }
        if (selector == governor.setVotingDelay.selector) ghostDelay = abi.decode(args, (uint48));
        else if (selector == governor.setVotingPeriod.selector) ghostPeriod = abi.decode(args, (uint32));
        else if (selector == governor.setProposalThreshold.selector) ghostThreshold = abi.decode(args, (uint256));
        else if (selector == governor.updateQuorumNumerator.selector) ghostNumerator = abi.decode(args, (uint256));
    }

    /// @dev The first proposal from the seed in `wanted` state (and, for a vote, not yet voted by `voter`).
    function _find(uint256 seed, IOZGovernor.ProposalState wanted, address voter)
        internal
        view
        returns (bool, uint256)
    {
        uint256 n = proposals.length;
        for (uint256 k; k < n; ++k) {
            uint256 i = (seed % n + k) % n;
            Proposal storage p = proposals[i];
            if (governor.state(p.id) != wanted) continue;
            if (voter != address(0) && governor.hasVoted(p.id, voter)) continue;
            return (true, i);
        }
        return (false, 0);
    }

    /// @dev The Safe never votes (D5); everyone else self-delegates on first receipt, so votes = balance.
    function _record(address account) internal {
        uint256 votes = account == safe ? 0 : captable.balanceOf(account);
        Point[] storage h = ghostVotes[account];
        if (h.length > 0 && h[h.length - 1].time == block.timestamp) h[h.length - 1].votes = votes;
        else h.push(Point(block.timestamp, votes));
    }

    function _ghostVotesAt(address account, uint256 time) internal view returns (uint256 votes) {
        Point[] storage h = ghostVotes[account];
        for (uint256 i; i < h.length && h[i].time <= time; ++i) {
            votes = h[i].votes;
        }
    }

    function _one(address a) internal pure returns (address[] memory list) {
        list = new address[](1);
        list[0] = a;
    }

    function _one(bytes memory d) internal pure returns (bytes[] memory list) {
        list = new bytes[](1);
        list[0] = d;
    }
}
