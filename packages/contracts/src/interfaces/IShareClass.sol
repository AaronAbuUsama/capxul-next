// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC5805 } from "@openzeppelin/contracts/interfaces/IERC5805.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @title IShareClass
/// @notice One ERC20Votes token per share class (spec/share-class.md), cloned by the Captable. Whole shares
/// (0 decimals), timestamp clock, votes self-delegated on first receipt except the company Safe's. Shares the
/// Safe holds carry no votes and are checkpointed so the Captable leaves them out of supply (ruling D5).
/// Ported from Firm `EquityToken.sol`.
/// @dev Ordinary transfers call `ICaptable.checkTransfer` first and bubble its `TransferNotAllowed` and
/// `SharesLocked`. `delegate` and `delegateBySig` revert `SafeCannotVote` when the delegator or the delegatee
/// is the Safe.
interface IShareClass is IERC20Metadata, IERC5805 {
    error OnlyCaptable();
    error SafeCannotVote();

    /// @notice Sets the token once and reads and stores `safe = ICaptable(captable).safe()`. The implementation
    /// cannot be initialised (N-6).
    /// @param name_ "<company> <class>".
    /// @param symbol_ The class's ticker.
    /// @param captable_ The Captable that owns the class.
    /// @param classId_ The class's id in that Captable.
    function initialize(string calldata name_, string calldata symbol_, address captable_, uint8 classId_) external;

    /// @notice The Captable that owns this class.
    /// @return The Captable.
    function captable() external view returns (address);

    /// @notice This class's id in its Captable.
    /// @return The class id.
    function classId() external view returns (uint8);

    /// @notice The company Safe, read from the Captable at `initialize` and fixed.
    /// @return The Safe.
    function safe() external view returns (address);

    /// @notice Mints shares without the transfer check. Only the Captable.
    /// @param to The receiver.
    /// @param amount The shares.
    function mint(address to, uint256 amount) external;

    /// @notice Burns shares without the transfer check. Only the Captable.
    /// @param from The shareholder.
    /// @param amount The shares.
    function burn(address from, uint256 amount) external;

    /// @notice Moves shares without the transfer check (a forced transfer). Only the Captable.
    /// @param from The shareholder.
    /// @param to The receiver.
    /// @param amount The shares.
    function forcedMove(address from, address to, uint256 amount) external;

    /// @notice The Safe's balance of this class at a timepoint, from its own checkpoints.
    /// @param timepoint A timestamp, now or in the past; at now it equals `balanceOf(safe())`.
    /// @return The Safe's balance then.
    function safeBalanceAt(uint256 timepoint) external view returns (uint256);
}
