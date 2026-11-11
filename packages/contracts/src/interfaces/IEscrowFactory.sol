// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IEscrow } from "./IEscrow.sol";
import { IPayments } from "./IPayments.sol";

/// @title IEscrowFactory
/// @notice Deploys each escrow at a CREATE2 address that can be predicted before it exists, so the payer
/// can fund it first (spec/escrow.md). The init code binds `payments` and `bootstrapOwner`.
interface IEscrowFactory {
    event EscrowDeployed(
        address indexed escrow, address indexed ownerSafe, address indexed payeeSafe, bytes32 paymentId, bytes32 salt
    );

    // The escrow's term errors, raised by the factory before it deploys (same selectors as IEscrow's).
    error ZeroAddress();
    error ZeroAmount();
    error ZeroJobNonce();
    error ZeroDocumentHash();
    error InvalidCondition(uint8 condition);

    /// @notice The Payments contract every escrow pays through.
    /// @return Payments.
    function payments() external view returns (IPayments);

    /// @notice The chain's Companies House Safe.
    /// @return The bootstrap owner.
    function bootstrapOwner() external view returns (address);

    /// @notice Deploys the escrow for `terms` and `salt`, or returns the one already there. Emits
    /// `EscrowDeployed` on a deploy.
    /// @param terms The escrow's terms.
    /// @param salt The CREATE2 salt.
    /// @return escrow The escrow's address.
    function deploy(IEscrow.Terms calldata terms, bytes32 salt) external returns (address escrow);

    /// @notice The CREATE2 address `deploy` uses for these terms and salt.
    /// @param terms The escrow's terms.
    /// @param salt The CREATE2 salt.
    /// @return The predicted address.
    function predictAddress(IEscrow.Terms calldata terms, bytes32 salt) external view returns (address);

    /// @notice The Payments id the escrow for these terms and salt will report; a claim escrow binds its own
    /// predicted address as executor.
    /// @param terms The escrow's terms.
    /// @param salt The CREATE2 salt.
    /// @return The predicted payment id.
    function predictPaymentId(IEscrow.Terms calldata terms, bytes32 salt) external view returns (bytes32);
}
