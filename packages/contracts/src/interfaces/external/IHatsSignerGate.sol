// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @title IHatsSignerGate
/// @notice The parts of Hats Signer Gate v2.0.0 (implementation 0x148057884AC910Bdd93693F230C5c35a8c47CA3b) that the
/// protocol calls, and the refusals the specs name. Types and signatures checked against the source verified on
/// Base Sepolia Blockscout (Hats-Protocol/hats-zodiac, `src/interfaces/IHatsSignerGate.sol`).
interface IHatsSignerGate {
    /// @dev ABSOLUTE: a number of signatures. PROPORTIONAL: basis points of the signers.
    enum TargetThresholdType {
        ABSOLUTE,
        PROPORTIONAL
    }

    struct ThresholdConfig {
        TargetThresholdType thresholdType;
        uint120 min;
        uint120 target;
    }

    /// @notice `setUp`'s parameters, passed ABI-encoded.
    struct SetupParams {
        uint256 ownerHat;
        uint256[] signerHats;
        address safe;
        ThresholdConfig thresholdConfig;
        bool locked;
        bool claimableFor;
        address implementation;
        address hsgGuard;
        address[] hsgModules;
    }

    /// @notice The Safe's threshold does not match the config for its owner count, or owners are below `min`.
    error ThresholdTooLow();
    /// @notice Too few signatures from valid signer-hat wearers.
    error InsufficientValidSignatures();
    /// @notice `removeSigner` named an account that still wears its signer hat.
    error StillWearsSignerHat();
    /// @notice A transaction changed the Safe's modules, or ran while another module is on the Safe.
    error CannotChangeModules();
    /// @notice A transaction called the Safe itself.
    error CannotCallSafe();
    /// @notice A module call reached the Safe while a Safe transaction was running (a nested call).
    error NoReentryAllowed();

    /// @notice Initialises a proxy. ModuleProxyFactory calls it with `abi.encode(SetupParams)`. With an existing
    /// Safe it does not attach itself: the Safe must then enable it as module and set it as guard.
    /// @param initializeParams `abi.encode(SetupParams)`.
    function setUp(bytes calldata initializeParams) external payable;

    /// @notice Registers `signer`, a wearer of `hatId`, and adds it as a Safe owner if it is not one. Anyone may
    /// call it while `claimableFor` is on.
    /// @param hatId The signer hat.
    /// @param signer The wearer.
    function claimSignerFor(uint256 hatId, address signer) external;

    /// @notice Removes a Safe owner that is not a valid signer and recomputes the threshold. Anyone may call it.
    /// @param signer The owner to remove.
    function removeSigner(address signer) external;

    /// @notice Sets the threshold config and rewrites the Safe's threshold. Owner hat only.
    /// @param thresholdConfig The new config.
    function setThresholdConfig(ThresholdConfig memory thresholdConfig) external;

    /// @notice Whether `account` wears the signer hat it registered with (a live read).
    /// @param account The account.
    /// @return valid True if valid.
    function isValidSigner(address account) external view returns (bool valid);

    /// @notice The Safe this Gate serves.
    /// @return The Safe.
    function safe() external view returns (address);
}
