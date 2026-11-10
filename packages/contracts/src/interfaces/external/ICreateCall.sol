// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @title ICreateCall
/// @notice CreateCall 1.4.1 (0x9b35Af71d77eaf8d7e40252370304687390A1A52). Companies House delegatecalls it, so the
/// CREATE2 deployer of every v4 contract is the Companies House Safe itself.
interface ICreateCall {
    /// @notice Deploys `deploymentData` by CREATE2 from the calling context.
    /// @param value The ETH sent to the new contract.
    /// @param deploymentData Creation code with constructor arguments.
    /// @param salt The CREATE2 salt.
    /// @return newContract The new contract's address.
    function performCreate2(
        uint256 value,
        bytes memory deploymentData,
        bytes32 salt
    )
        external
        returns (address newContract);
}
