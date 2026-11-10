// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IPayments } from "./IPayments.sol";

/// @title IEscrow
/// @notice Holds one fixed payment until one fixed release condition (spec/escrow.md): the invoice amount
/// is held (`payout`, anyone), or the payee Safe has been claimed from Companies House (`collect`, the
/// payee). Pays through Payments. The payer may refund as D12 says.
interface IEscrow {
    /// @notice The escrow's lifecycle.
    enum State {
        Open,
        Paid,
        Refunded
    }

    /// @notice An escrow's fixed terms.
    struct Terms {
        address ownerSafe; // the payer; refunds go here
        address payeeSafe;
        address token;
        uint256 amount;
        bytes32 jobNonce;
        uint16 kind;
        bytes32 documentHash;
        uint8 condition; // CONDITION_INVOICE_AMOUNT_REACHED or CONDITION_PAYEE_CLAIMED
    }

    event EscrowCreated(
        address indexed ownerSafe,
        address indexed payeeSafe,
        bytes32 indexed paymentId,
        address token,
        uint256 amount,
        uint16 kind,
        bytes32 documentHash,
        uint8 condition
    );
    event EscrowPaid(address indexed ownerSafe, address indexed payeeSafe, bytes32 indexed paymentId, uint256 amount);
    event EscrowRefunded(address indexed ownerSafe, bytes32 indexed paymentId, uint256 amount, State state);
    event InvoicePaymentCompleted(
        address indexed ownerSafe, address indexed payeeSafe, bytes32 indexed paymentId, uint256 surplus
    );

    error ZeroAddress();
    error ZeroAmount();
    error ZeroJobNonce();
    error ZeroDocumentHash();
    error InvalidCondition(uint8 condition);
    error JobNotOpen();
    error ConditionNotMet();
    error InsufficientFunding();
    error ConditionMet();
    error NotOwner();
    error NotPayee();
    error TokenHasNoCode(address token);
    error TokenCallReturnedFalse(address token);
    error ReentrantCall();

    /// @notice Condition 0: anyone may `payout` once the escrow holds `amount`.
    /// @return 0.
    function CONDITION_INVOICE_AMOUNT_REACHED() external view returns (uint8);

    /// @notice Condition 1: the payee Safe may `collect` once Companies House is not one of its owners.
    /// @return 1.
    function CONDITION_PAYEE_CLAIMED() external view returns (uint8);

    /// @notice The payer Safe.
    /// @return The owner Safe.
    function ownerSafe() external view returns (address);

    /// @notice The payee Safe.
    /// @return The payee Safe.
    function payeeSafe() external view returns (address);

    /// @notice The token held and paid.
    /// @return The token.
    function token() external view returns (address);

    /// @notice The amount paid to the payee.
    /// @return The amount.
    function amount() external view returns (uint256);

    /// @notice The Payments id of the escrow's one payment.
    /// @return The payment id.
    function paymentId() external view returns (bytes32);

    /// @notice The payment's job nonce.
    /// @return The job nonce.
    function jobNonce() external view returns (bytes32);

    /// @notice The payment kind.
    /// @return The kind.
    function kind() external view returns (uint16);

    /// @notice The document the payment settles.
    /// @return The document hash.
    function documentHash() external view returns (bytes32);

    /// @notice The release condition.
    /// @return The condition.
    function condition() external view returns (uint8);

    /// @notice The Payments contract the escrow pays through.
    /// @return Payments.
    function payments() external view returns (IPayments);

    /// @notice The chain's Companies House Safe.
    /// @return The bootstrap owner.
    function bootstrapOwner() external view returns (address);

    /// @notice The escrow's state.
    /// @return The state.
    function state() external view returns (State);

    /// @notice Whether the release condition is met. For the claim condition: the payee has code and
    /// answers `isOwner(bootstrapOwner)` with exactly `false`; any other answer fails closed (D11).
    /// @return True if met.
    function conditionMet() external view returns (bool);

    /// @notice Pays an invoice escrow to the payee once it holds the amount, returning any surplus to the
    /// owner. Anyone may call. Emits `EscrowPaid`, or `InvoicePaymentCompleted` if the payment id was
    /// already paid.
    function payout() external;

    /// @notice The claimed payee Safe collects a claim escrow. A registered exit claim sends any surplus
    /// to the payee; other claims return it to the owner. Emits `EscrowPaid`.
    function collect() external;

    /// @notice The owner Safe takes the escrow's balance back: an invoice escrow while open and short of
    /// the amount, a claim escrow while open even after the claim (D12), and any later deposit after
    /// `Paid` or `Refunded` without changing the state. Emits `EscrowRefunded`.
    function refund() external;
}
