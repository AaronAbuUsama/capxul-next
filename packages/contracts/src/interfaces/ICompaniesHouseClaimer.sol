// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @title ICompaniesHouseClaimer
/// @notice The one thing a Companies House service role may do (spec/companies-house.md, ruling D13): deploy a
/// Capxul personal Safe if it is not there yet, and swap the Companies House owner out for the person's signer.
/// A Roles role on Companies House may only delegatecall `claim`, with its tier's namespace pinned, so the code runs
/// as Companies House. The derivation is `setup([owner], 1, MultiSend 1.4.1,
/// multiSend(delegatecall SafeModuleSetup.enableModules([Safe4337Module 0.3.0])), Safe4337Module, 0, 0, 0)` on the
/// SafeL2 1.5.0 singleton through SafeProxyFactory 1.5.0, salt nonce `keccak256(namespace ":" email)`, byte for byte
/// as the protocol package's `safe-address.ts`. The claimer holds no state and writes no storage (CH9).
interface ICompaniesHouseClaimer {
    /// @notice A Capxul personal Safe now has the person's signer as its sole owner.
    /// @param safe The personal Safe.
    /// @param signer Its new sole owner.
    /// @param deployed True if this claim deployed the Safe.
    event CapxulSafeClaimed(address indexed safe, address indexed signer, bool deployed);

    /// @notice `claim` ran as a plain call, not as Companies House's delegatecall.
    error NotDelegateCall();
    /// @notice The namespace is empty.
    error EmptyNamespace();
    /// @notice The email is empty, not trimmed and lowercased, or not ASCII.
    error EmailNotNormalized();
    /// @notice The signer is zero, the owners sentinel, or Companies House itself.
    error InvalidSigner();
    /// @notice The factory deployed somewhere other than the derived address.
    error DerivedAddressMismatch(address expected, address deployed);
    /// @notice The Safe refused the owner swap.
    error SwapRefused();

    /// @notice Deploys the Capxul personal Safe for `namespace` and `email` if it has no code, then makes `signer`
    /// its sole owner at threshold 1. Only as Companies House's delegatecall.
    /// @param namespace The tier's salt namespace, for example `capxul:beta:email:v1`.
    /// @param email The person's email, already trimmed and lowercased, ASCII only.
    /// @param signer The person's signer address.
    /// @return safe The claimed Safe.
    function claim(string calldata namespace, string calldata email, address signer) external returns (address safe);

    /// @notice The Capxul personal Safe address for an owner, namespace and email.
    /// @param owner The bootstrap owner (Companies House).
    /// @param namespace The tier's salt namespace.
    /// @param email The person's email, normalised.
    /// @return The derived Safe address.
    function safeAddressFor(
        address owner,
        string calldata namespace,
        string calldata email
    )
        external
        pure
        returns (address);
}
