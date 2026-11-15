// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @notice ERC-4337 v0.7's packed UserOperation, as the EntryPoint v0.7 and the Safe4337Module take it.
struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
}

/// @title ISafe4337Module
/// @notice The parts of Safe's Safe4337Module v0.3.0 (0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226) that Capxul's off-chain
/// code calls (safe-global/safe-modules, `modules/4337/contracts/Safe4337Module.sol`). No contract of this package
/// imports it, so a change here changes no deployed code (roadmap step 3.1).
interface ISafe4337Module {
    /// @notice Runs a call from the Safe, as a UserOperation's call data asks; only the EntryPoint may call it.
    /// @param operation 0 = call, 1 = delegatecall.
    function executeUserOp(address to, uint256 value, bytes calldata data, uint8 operation) external;

    /// @notice The hash a Safe's owners sign for `userOp`.
    function getOperationHash(PackedUserOperation calldata userOp) external view returns (bytes32 operationHash);
}
