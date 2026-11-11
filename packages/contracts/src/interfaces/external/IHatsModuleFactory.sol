// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @title IHatsModuleFactory
/// @notice The parts of HatsModuleFactory v0.7.0 (0x0a3f85fa597B6a967271286aA0724811acDF5CD9) that the protocol
/// calls. Signatures checked against the source verified on Base Sepolia Blockscout (Hats-Protocol/hats-module,
/// `src/HatsModuleFactory.sol`). The salt omits `initData`, so anyone can deploy the predicted clone first with
/// other init data (research R3 section 3).
interface IHatsModuleFactory {
    /// @notice Deploys a clone of `implementation` for `hatId` and initialises it with `initData`. Anyone may call
    /// it; reverts if the clone already exists.
    /// @param implementation The module implementation.
    /// @param hatId The hat the module serves.
    /// @param otherImmutableArgs Further immutable arguments (for Elections: `abi.encodePacked(BALLOT_BOX_HAT,
    /// ADMIN_HAT)`).
    /// @param initData The initialisation data (for Elections: `abi.encode(uint128 firstTermEnd)`).
    /// @param saltNonce The salt nonce.
    /// @return instance The new module.
    function createHatsModule(
        address implementation,
        uint256 hatId,
        bytes calldata otherImmutableArgs,
        bytes calldata initData,
        uint256 saltNonce
    )
        external
        returns (address instance);

    /// @notice The address `createHatsModule` deploys to for these arguments.
    /// @param implementation The module implementation.
    /// @param hatId The hat the module serves.
    /// @param otherImmutableArgs Further immutable arguments.
    /// @param saltNonce The salt nonce.
    /// @return The predicted address.
    function getHatsModuleAddress(
        address implementation,
        uint256 hatId,
        bytes calldata otherImmutableArgs,
        uint256 saltNonce
    )
        external
        view
        returns (address);
}
