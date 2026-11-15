// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @title ISafeState
/// @notice The reads of Safe 1.5.0 (SafeL2 singleton 0xEdd160fEBBD92E350D4D398fb636302fccd67C7e) that Capxul's off-chain
/// code makes and `ISafe` does not declare (safe-global/safe-smart-account, `OwnerManager.sol`, `Safe.sol`). Not merged
/// into `ISafe`: the deployed contracts import `ISafe.sol`, so changing it would change their code (roadmap step 3.1).
interface ISafeState {
    /// @notice How many owners must sign.
    function getThreshold() external view returns (uint256);

    /// @notice The nonce of the Safe's next transaction.
    function nonce() external view returns (uint256);
}
