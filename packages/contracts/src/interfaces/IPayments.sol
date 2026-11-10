// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @title IPayments
/// @notice The one way money moves (spec/payments.md): an exact transfer of one token amount from the
/// caller to a fixed recipient, identified by a hash of every term, consumed once, stamped with a `kind`
/// and a document hash. No funds held, no owner, no privileged function.
interface IPayments {
    /// @notice One payment's terms.
    /// @dev `paymentId` must equal `paymentId(item)` and is not part of the hash.
    struct PaymentItem {
        bytes32 paymentId;
        address recipient; // never zero, never Payments itself (D9)
        address token;
        uint256 amount;
        uint16 kind; // architecture.md, payment kinds
        bytes32 documentHash; // never zero
        bytes32 jobNonce; // the payer's unique nonce for this payment; never zero
        address executor; // if nonzero, only this caller may send the item
    }

    /// @notice A payment was made.
    event PaymentSent(
        bytes32 indexed paymentId,
        address indexed sender,
        address indexed recipient,
        address token,
        uint256 amount,
        uint16 kind,
        bytes32 documentHash
    );

    error ZeroAmount();
    error ZeroAddress();
    error InvalidRecipient();
    error ZeroPaymentId();
    error ZeroDocumentHash();
    error ZeroJobNonce();
    error PaymentIdMismatch(bytes32 expected, bytes32 supplied);
    error InvalidExecutor(address expected, address supplied);
    error PaymentIdConsumed(bytes32 paymentId);
    error TokenHasNoCode(address token);
    error TokenCallReturnedFalse(address token);
    error InexactTransfer(address token, uint256 expected, uint256 received);
    error ReentrantCall();

    /// @notice The id of `item`: a hash of the type hash, chain id, this contract and every term except
    /// `item.paymentId`.
    /// @param item The payment's terms.
    /// @return The payment id.
    function paymentId(PaymentItem calldata item) external view returns (bytes32);

    /// @notice Validates `item`, consumes its id and moves exactly `amount` of `token` from the caller to
    /// the recipient. Only `executor` may call when it is set. Emits `PaymentSent`.
    /// @param item The payment's terms, with its id.
    function send(PaymentItem calldata item) external;

    /// @notice Sends each item in order, atomically: all are paid or none. An empty batch does nothing.
    /// @param items The payments to send.
    function sendBatch(PaymentItem[] calldata items) external;

    /// @notice Whether a payment id has been consumed.
    /// @param id The payment id.
    /// @return True once the id has paid.
    function paid(bytes32 id) external view returns (bool);
}
