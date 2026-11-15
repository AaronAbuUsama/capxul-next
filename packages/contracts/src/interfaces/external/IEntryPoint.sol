// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @title IEntryPoint
/// @notice The parts of ERC-4337's EntryPoint v0.7 (0x0000000071727De22E5E9d8BAf0edAc6f37da032) that Capxul's
/// off-chain code reads (eth-infinitism/account-abstraction v0.7.0, `contracts/interfaces/IEntryPoint.sol`,
/// `INonceManager.sol` and `IStakeManager.sol`). No contract of this package imports it, so a change here changes no deployed code; it is here
/// so the compiled contracts own every event and function off-chain code uses (roadmap step 3.1).
interface IEntryPoint {
    /// @notice One UserOperation ran.
    event UserOperationEvent(
        bytes32 indexed userOpHash,
        address indexed sender,
        address indexed paymaster,
        uint256 nonce,
        bool success,
        uint256 actualGasCost,
        uint256 actualGasUsed
    );

    /// @notice A UserOperation's call reverted, with its reason.
    event UserOperationRevertReason(
        bytes32 indexed userOpHash, address indexed sender, uint256 nonce, bytes revertReason
    );

    /// @notice What `account` has deposited to pay for its UserOperations (`IStakeManager`).
    function balanceOf(address account) external view returns (uint256);

    /// @notice The next nonce of `sender` for the nonce key `key`.
    function getNonce(address sender, uint192 key) external view returns (uint256 nonce);
}
