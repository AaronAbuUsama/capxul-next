// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IGovernor as IOZGovernor } from "@openzeppelin/contracts/governance/IGovernor.sol";
import { IERC6372 } from "@openzeppelin/contracts/interfaces/IERC6372.sol";
import { IERC5805 } from "@openzeppelin/contracts/interfaces/IERC5805.sol";
import { IVotes } from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { GovernorUpgradeable } from "@openzeppelin/contracts-upgradeable/governance/GovernorUpgradeable.sol";
import {
    GovernorCountingSimpleUpgradeable
} from "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorCountingSimpleUpgradeable.sol";
import {
    GovernorSettingsUpgradeable
} from "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorSettingsUpgradeable.sol";
import {
    GovernorVotesQuorumFractionUpgradeable
} from "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorVotesQuorumFractionUpgradeable.sol";
import {
    GovernorVotesUpgradeable
} from "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorVotesUpgradeable.sol";

import { IGovernor } from "../interfaces/IGovernor.sol";
import { IShareClass } from "../interfaces/IShareClass.sol";

/// @title Governor
/// @notice One clone per company (votes = the Captable) and one per class vote (votes = a ShareClass token),
/// an OpenZeppelin 5 Governor with settings, simple counting, votes and a basis-point quorum, no timelock
/// (docs/planning/protocol-v4/spec/governor.md). Only the overrides below are ours (J9): the allowed
/// targets, `pendingUntil`, the N-7 deposit refusals, `relay` disabled and initialise-once.
contract Governor is
    IGovernor,
    GovernorUpgradeable,
    GovernorSettingsUpgradeable,
    GovernorCountingSimpleUpgradeable,
    GovernorVotesUpgradeable,
    GovernorVotesQuorumFractionUpgradeable
{
    address private _safe;
    uint48 private _pendingUntil;
    address[] private _allowedTargets;
    mapping(address target => bool) private _isAllowed;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @inheritdoc IGovernor
    function initialize(
        string calldata name_,
        IERC5805 votes,
        // forge-lint: disable-next-line(missing-zero-check) -- the Installer passes the company Safe
        address safe_,
        address[] calldata targets,
        uint48 delay,
        uint32 period,
        uint256 threshold,
        uint256 numerator
    )
        external
        initializer
    {
        __Governor_init(name_);
        __GovernorSettings_init(delay, period, threshold);
        __GovernorCountingSimple_init();
        __GovernorVotes_init(IVotes(address(votes)));
        __GovernorVotesQuorumFraction_init(numerator);

        _safe = safe_;
        if (safe_ == address(this)) revert TargetNotAllowed(safe_);
        for (uint256 i; i < targets.length; ++i) {
            // forge-lint: disable-next-line(require-revert-in-loop) -- first bad entry aborts
            if (targets[i] == safe_) revert TargetNotAllowed(safe_);
            _allow(targets[i]);
        }
        _allow(address(this));
    }

    function _allow(address target) private {
        _allowedTargets.push(target);
        _isAllowed[target] = true;
    }

    // ------------------------------------------------------------------ views

    /// @inheritdoc IGovernor
    function pendingUntil() external view returns (uint48) {
        return _pendingUntil;
    }

    /// @inheritdoc IGovernor
    function safe() external view returns (address) {
        return _safe;
    }

    /// @inheritdoc IGovernor
    function isAllowedTarget(address target) external view returns (bool) {
        return _isAllowed[target];
    }

    /// @inheritdoc IGovernor
    function allowedTargets() external view returns (address[] memory) {
        return _allowedTargets;
    }

    // ------------------------------------------------------------------ our overrides

    /// @dev Targets must be allowed (the Safe never is) and values zero (N-7); records the pending window (D6).
    function _propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description,
        address proposer
    )
        internal
        override
        returns (uint256 id)
    {
        for (uint256 i; i < targets.length; ++i) {
            // forge-lint: disable-next-line(require-revert-in-loop) -- first bad entry aborts
            if (!_isAllowed[targets[i]]) revert TargetNotAllowed(targets[i]);
        }
        for (uint256 i; i < values.length; ++i) {
            // forge-lint: disable-next-line(require-revert-in-loop) -- first bad entry aborts
            if (values[i] != 0) revert ValueNotAllowed();
        }
        id = super._propose(targets, values, calldatas, description, proposer);
        uint48 snapshot = SafeCast.toUint48(proposalSnapshot(id));
        if (snapshot > _pendingUntil) _pendingUntil = snapshot;
    }

    /// @inheritdoc GovernorUpgradeable
    function execute(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    )
        public
        payable
        override(GovernorUpgradeable, IOZGovernor)
        returns (uint256)
    {
        if (msg.value != 0) revert ValueNotAllowed();
        return super.execute(targets, values, calldatas, descriptionHash);
    }

    /// @inheritdoc GovernorUpgradeable
    function relay(address, uint256, bytes calldata) public payable override {
        revert RelayDisabled();
    }

    /// @inheritdoc GovernorUpgradeable
    receive() external payable override {
        revert GovernorDisabledDeposit();
    }

    /// @inheritdoc GovernorUpgradeable
    function onERC721Received(address, address, uint256, bytes memory) public pure override returns (bytes4) {
        revert GovernorDisabledDeposit();
    }

    /// @inheritdoc GovernorUpgradeable
    function onERC1155Received(address, address, uint256, uint256, bytes memory) public pure override returns (bytes4) {
        revert GovernorDisabledDeposit();
    }

    /// @inheritdoc GovernorUpgradeable
    function onERC1155BatchReceived(
        address,
        address,
        uint256[] memory,
        uint256[] memory,
        bytes memory
    )
        public
        pure
        override
        returns (bytes4)
    {
        revert GovernorDisabledDeposit();
    }

    /// @notice Basis points.
    function quorumDenominator() public pure override returns (uint256) {
        return 10_000;
    }

    /// @notice Quorum over the weighted supply without the Safe's shares (D5). The Captable's past supply
    /// already leaves them out and has no `safeBalanceAt`; a ShareClass token keeps them in and reports them.
    function quorum(uint256 timepoint)
        public
        view
        override(GovernorUpgradeable, GovernorVotesQuorumFractionUpgradeable, IOZGovernor)
        returns (uint256)
    {
        IERC5805 votes = token();
        uint256 supply = votes.getPastTotalSupply(timepoint);
        try IShareClass(address(votes)).safeBalanceAt(timepoint) returns (uint256 held) {
            supply -= held;
        } catch { }
        return Math.mulDiv(supply, quorumNumerator(timepoint), quorumDenominator());
    }

    // ------------------------------------------------------------------ OpenZeppelin diamond

    function votingDelay()
        public
        view
        override(GovernorUpgradeable, GovernorSettingsUpgradeable, IOZGovernor)
        returns (uint256)
    {
        return super.votingDelay();
    }

    function votingPeriod()
        public
        view
        override(GovernorUpgradeable, GovernorSettingsUpgradeable, IOZGovernor)
        returns (uint256)
    {
        return super.votingPeriod();
    }

    function proposalThreshold()
        public
        view
        override(GovernorUpgradeable, GovernorSettingsUpgradeable, IOZGovernor)
        returns (uint256)
    {
        return super.proposalThreshold();
    }

    function clock() public view override(GovernorUpgradeable, GovernorVotesUpgradeable, IERC6372) returns (uint48) {
        return super.clock();
    }

    // solhint-disable-next-line func-name-mixedcase
    function CLOCK_MODE()
        public
        view
        override(GovernorUpgradeable, GovernorVotesUpgradeable, IERC6372)
        returns (string memory)
    {
        return super.CLOCK_MODE();
    }
}
