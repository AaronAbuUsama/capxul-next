// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IGovernor as IOZGovernor } from "@openzeppelin/contracts/governance/IGovernor.sol";
import { IERC5805 } from "@openzeppelin/contracts/interfaces/IERC5805.sol";

/// @title IGovernor
/// @notice Capxul's additions to the OpenZeppelin 5 Governor (docs/planning/protocol-v4/spec/governor.md).
/// One clone per company (votes = the Captable) and one per class that needs a class vote (votes =
/// that class's ShareClass token). Timestamp clock, no timelock: a passed proposal executes as the
/// Governor itself, only on the allowed targets fixed at `initialize`, never on the company Safe (G1).
/// @dev Reserved matters (only a passed vote of the company Governor): create a class, change its
/// authorised amount or transfer rule, freeze it, name its class Governor (Captable); forced transfer
/// of unlocked shares (ruling D3); elect and remove directors through Hats Elections (D2, D15); set the
/// Hats Signer Gate's threshold range; approve a sale and redirect an exit claim (Exits). A class
/// Governor alone consents to a down round affecting its class (`Rounds.consent`).
///
/// It holds nothing (N-7, G4): `receive`, `onERC721Received`, `onERC1155Received` and
/// `onERC1155BatchReceived` revert `GovernorDisabledDeposit` (inherited), `propose` refuses a nonzero
/// value and `execute` refuses `msg.value > 0` (`ValueNotAllowed`). OpenZeppelin's `relay` always
/// reverts (`RelayDisabled`). Settings change only by a passed proposal (G5).
interface IGovernor is IOZGovernor {
    /// @notice A proposal target, or an allowed target at `initialize`, is outside the allowed list or
    /// is the company Safe.
    error TargetNotAllowed(address target);

    /// @notice A proposal carries a nonzero value, or `execute` was sent ether.
    error ValueNotAllowed();

    /// @notice `relay` is disabled.
    error RelayDisabled();

    /// @notice Sets the clone up once. The implementation's constructor disables initialisers (I3).
    /// @dev Reverts `TargetNotAllowed(safe)` if `allowedTargets` holds the Safe. Adds the Governor itself
    /// to its allowed targets (G-8). `pendingUntil` starts at 0.
    /// @param name The Governor's EIP-712 name.
    /// @param votes The Captable (company Governor) or the class's ShareClass token (class Governor);
    /// its timestamp clock is the Governor's clock.
    /// @param safe The company Safe, never a target.
    /// @param allowedTargets The only contracts a proposal may call; fixed for the clone's life.
    /// @param votingDelay Seconds from proposal to snapshot (default 1 day).
    /// @param votingPeriod Seconds of voting (default 7 days).
    /// @param proposalThreshold Weighted votes needed to propose (default 1% of weighted supply).
    /// @param quorumNumerator Quorum in basis points of weighted supply without the Safe's shares
    /// (default 5,000).
    function initialize(
        string calldata name,
        IERC5805 votes,
        address safe,
        address[] calldata allowedTargets,
        uint48 votingDelay,
        uint32 votingPeriod,
        uint256 proposalThreshold,
        uint256 quorumNumerator
    )
        external;

    /// @notice The latest snapshot of any proposal ever created (ruling D6). While
    /// `block.timestamp <= pendingUntil()` the Captable refuses to issue in a voting class (company
    /// Governor) or in this Governor's class (class Governor). Never decreases; a cancelled or defeated
    /// proposal still counts.
    /// @return The timestamp, 0 if no proposal was ever created.
    function pendingUntil() external view returns (uint48);

    /// @notice The company Safe, which the Governor never calls.
    /// @return The Safe's address.
    function safe() external view returns (address);

    /// @notice Whether a proposal may call `target`.
    /// @param target The address to check.
    /// @return True for an allowed target, the Governor itself included.
    function isAllowedTarget(address target) external view returns (bool);

    /// @notice Every allowed target, in the order set at `initialize`, the Governor itself last.
    /// @return The list.
    function allowedTargets() external view returns (address[] memory);
}
