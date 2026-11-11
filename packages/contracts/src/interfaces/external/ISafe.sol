// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @title ISafe
/// @notice The parts of Safe 1.5.0 (SafeL2 singleton 0xEdd160fEBBD92E350D4D398fb636302fccd67C7e) that the protocol
/// calls. Signatures checked against the source verified on Base Sepolia Blockscout
/// (safe-global/safe-smart-account v1.4.1); every one is unchanged in v1.5.0. `operation` is Safe's `Enum.Operation` as a uint8: 0 = call,
/// 1 = delegatecall.
interface ISafe {
    /// @notice Sets up a new Safe proxy. Used only to encode the initializer of a Capxul personal Safe.
    /// @param owners The owners.
    /// @param threshold The number of owner signatures required.
    /// @param to The contract to delegatecall during setup (MultiSend), or zero.
    /// @param data The delegatecall's data.
    /// @param fallbackHandler The fallback handler, or zero.
    /// @param paymentToken The setup payment token (zero for ETH).
    /// @param payment The setup payment.
    /// @param paymentReceiver The setup payment's receiver.
    function setup(
        address[] calldata owners,
        uint256 threshold,
        address to,
        bytes calldata data,
        address fallbackHandler,
        address paymentToken,
        uint256 payment,
        address payable paymentReceiver
    )
        external;

    /// @notice Executes a Safe transaction once enough owners have signed it.
    /// @param to The destination.
    /// @param value The ETH value.
    /// @param data The call data.
    /// @param operation 0 = call, 1 = delegatecall.
    /// @param safeTxGas Gas for the inner call.
    /// @param baseGas Gas costs independent of the inner call.
    /// @param gasPrice The refund gas price (0 for no refund).
    /// @param gasToken The refund token (zero for ETH).
    /// @param refundReceiver The refund receiver.
    /// @param signatures The packed owner signatures (`v = 1` for an approved hash or the sender).
    /// @return success Whether the inner call succeeded.
    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures
    )
        external
        payable
        returns (bool success);

    /// @notice Replaces `oldOwner` with `newOwner`. Only the Safe itself may call it.
    /// @param prevOwner The owner before `oldOwner` in the linked list (the sentinel 0x1 for the first).
    /// @param oldOwner The owner removed.
    /// @param newOwner The owner added.
    function swapOwner(address prevOwner, address oldOwner, address newOwner) external;

    /// @notice Enables a module. Only the Safe itself may call it.
    /// @param module The module.
    function enableModule(address module) external;

    /// @notice Disables a module. Only the Safe itself may call it.
    /// @param prevModule The module before `module` in the linked list (the sentinel 0x1 for the first).
    /// @param module The module.
    function disableModule(address prevModule, address module) external;

    /// @notice Sets the transaction guard. Only the Safe itself may call it.
    /// @param guard The guard, or zero to remove it.
    function setGuard(address guard) external;

    /// @notice Sets the fallback handler. Only the Safe itself may call it.
    /// @param handler The handler, or zero to remove it.
    function setFallbackHandler(address handler) external;

    /// @notice A page of the enabled modules, in linked-list order.
    /// @param start The sentinel 0x1 for the first page, or the `next` of the previous page.
    /// @param pageSize The most modules to return; more than zero.
    /// @return array The modules.
    /// @return next The start of the next page, or the sentinel 0x1 after the last module.
    function getModulesPaginated(
        address start,
        uint256 pageSize
    )
        external
        view
        returns (address[] memory array, address next);

    /// @notice The owners, in linked-list order.
    /// @return The owners.
    function getOwners() external view returns (address[] memory);

    /// @notice Whether `owner` is an owner.
    /// @param owner The account.
    /// @return True if it is an owner.
    function isOwner(address owner) external view returns (bool);

    /// @notice Reads raw storage words. The fallback handler is at slot
    /// 0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5 and the guard at
    /// 0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8 (FallbackManager.sol:14,
    /// GuardManager.sol:42).
    /// @param offset The first slot.
    /// @param length The number of words.
    /// @return The words, concatenated.
    function getStorageAt(uint256 offset, uint256 length) external view returns (bytes memory);
}

/// @title ISafeProxyFactory
/// @notice SafeProxyFactory 1.5.0 (0x14F2982D601c9458F93bd70B218933A6f8165e7b), as CompaniesHouseClaimer calls it.
interface ISafeProxyFactory {
    /// @notice Deploys a Safe proxy by CREATE2 with salt `keccak256(keccak256(initializer) ++ saltNonce)` and
    /// calls it with `initializer`.
    /// @param singleton The Safe singleton.
    /// @param initializer The `setup` call.
    /// @param saltNonce The salt nonce.
    /// @return proxy The new Safe.
    function createProxyWithNonce(
        address singleton,
        bytes memory initializer,
        uint256 saltNonce
    )
        external
        returns (address proxy);
}

/// @title ISafeModuleSetup
/// @notice SafeModuleSetup from Safe 4337 module 0.3.0 (0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47),
/// delegatecalled during a personal Safe's setup.
interface ISafeModuleSetup {
    /// @notice Enables modules on the Safe that delegatecalls it.
    /// @param modules The modules.
    function enableModules(address[] calldata modules) external;
}
