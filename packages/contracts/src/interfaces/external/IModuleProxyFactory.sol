// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @title IModuleProxyFactory
/// @notice Zodiac ModuleProxyFactory (0x000000000000aDdB49795b0f9bA5BC298cDda236). It deploys the company's Roles
/// modifier and its Hats Signer Gate (HSG v2 has no factory of its own).
interface IModuleProxyFactory {
    /// @notice Deploys an EIP-1167 proxy of `masterCopy` by CREATE2 with salt
    /// `keccak256(keccak256(initializer) ++ saltNonce)`, then calls it with `initializer`. Reverts if the address is
    /// taken, so the same initializer and nonce can be deployed only once.
    /// @param masterCopy The implementation.
    /// @param initializer The proxy's `setUp` call.
    /// @param saltNonce The salt nonce.
    /// @return proxy The new module.
    function deployModule(
        address masterCopy,
        bytes memory initializer,
        uint256 saltNonce
    )
        external
        returns (address proxy);
}
