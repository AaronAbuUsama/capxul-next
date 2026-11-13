// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IPayments } from "./IPayments.sol";

/// @title IEscrow
/// @notice The general escrow (aaron.escrow-general; docs/design/escrow.md in capxul-next). One escrow holds one
/// payment of `amount` of `token` for its `owner`, an account that may not exist yet. Two ways out, and only two:
/// to the owner through Payments (`collect` by the owner, or `payout` by anyone for an invoice), or back to the
/// `sender` (`refund`, by the sender or a caller the `authority` term admits). No expiry and no clock: nothing
/// here reads the time.
interface IEscrow {
    /// @notice The escrow's lifecycle.
    enum State {
        Open,
        Paid,
        Refunded
    }

    /// @notice An escrow's fixed terms. The factory's CREATE2 init code binds every one of them.
    struct Terms {
        address owner; // who collects; the only address `collect` or `payout` pays the amount
        address sender; // where the money came from; the only address `refund` pays
        address authority; // zero, or a view `authorised(uint256 key, address who) returns (bool)`
        uint256 authorityKey; // the key the authority is asked about (a budget id)
        address bootstrapOwner; // zero, or an address the owner must no longer list as an owner to collect
        address token;
        uint256 amount;
        bytes32 jobNonce;
        uint16 kind;
        bytes32 documentHash;
        uint8 condition; // CONDITION_AMOUNT_REACHED or CONDITION_OWNER_COLLECTS
        bool ownerTakesSurplus; // a collection's surplus goes to the owner, not back to the sender
    }

    event EscrowCreated(
        address indexed owner,
        address indexed sender,
        bytes32 indexed paymentId,
        address token,
        uint256 amount,
        uint16 kind,
        bytes32 documentHash,
        uint8 condition,
        address authority,
        uint256 authorityKey
    );
    event EscrowPaid(address indexed owner, address indexed sender, bytes32 indexed paymentId, uint256 amount);
    event EscrowRefunded(
        address indexed sender, address indexed by, bytes32 indexed paymentId, uint256 amount, State state
    );
    event InvoicePaymentCompleted(
        address indexed owner, address indexed sender, bytes32 indexed paymentId, uint256 surplus
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
    error CannotRefund(address who);
    error TokenHasNoCode(address token);
    error TokenCallReturnedFalse(address token);
    error ReentrantCall();

    /// @notice Condition 0: the owner's claim stands in the terms; anyone may `payout` once the escrow holds
    /// `amount` (an invoice).
    /// @return 0.
    function CONDITION_AMOUNT_REACHED() external view returns (uint8);

    /// @notice Condition 1: the owner `collect`s when it chooses, once it can act.
    /// @return 1.
    function CONDITION_OWNER_COLLECTS() external view returns (uint8);

    /// @notice Who collects.
    /// @return The owner.
    function owner() external view returns (address);

    /// @notice Where the money came from, and the only address a refund pays.
    /// @return The sender.
    function sender() external view returns (address);

    /// @notice The view a refund by anyone but the sender asks, or zero.
    /// @return The authority.
    function authority() external view returns (address);

    /// @notice The key the authority is asked about.
    /// @return The authority key.
    function authorityKey() external view returns (uint256);

    /// @notice The address the owner must no longer list among its owners before it can collect, or zero.
    /// @return The bootstrap owner.
    function bootstrapOwner() external view returns (address);

    /// @notice The token held and paid.
    /// @return The token.
    function token() external view returns (address);

    /// @notice The amount paid to the owner.
    /// @return The amount.
    function amount() external view returns (uint256);

    /// @notice The Payments id of the escrow's one payment to the owner.
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

    /// @notice Whether a collection's surplus goes to the owner rather than the sender.
    /// @return True if the owner takes the surplus.
    function ownerTakesSurplus() external view returns (bool);

    /// @notice The Payments contract the escrow pays through.
    /// @return Payments.
    function payments() external view returns (IPayments);

    /// @notice The escrow's state.
    /// @return The state.
    function state() external view returns (State);

    /// @notice Whether the release condition is met. Amount-reached: the escrow holds `amount`. Owner-collects:
    /// with no bootstrap owner, always; else the owner has code and answers `isOwner(bootstrapOwner)` with
    /// exactly `false`. Any other answer fails closed (D11).
    /// @return True if met.
    function conditionMet() external view returns (bool);

    /// @notice Whether `who` may refund now: the sender, or a caller the authority answers exactly `true` for
    /// under `authorityKey`. A revert or a malformed answer refuses.
    /// @param who The caller to check.
    /// @return True if `who` may refund.
    function canRefund(address who) external view returns (bool);

    /// @notice Pays an amount-reached escrow to the owner once it holds the amount, returning any surplus to
    /// the sender. Anyone may call. Emits `EscrowPaid`, or `InvoicePaymentCompleted` if the payment id was
    /// already paid through Payments.
    function payout() external;

    /// @notice The owner collects an owner-collects escrow once it can act and the escrow holds the amount.
    /// Pays exactly `amount` through Payments, the escrow its executor, and the surplus to the sender (to the
    /// owner with `ownerTakesSurplus`). Emits `EscrowPaid`.
    function collect() external;

    /// @notice The sender, or a caller the authority admits, takes the escrow's balance back to the sender: an
    /// amount-reached escrow while open and short of the amount, an owner-collects escrow while open even after
    /// the owner can act (D12), and any later deposit after `Paid` or `Refunded` without changing the state.
    /// Emits `EscrowRefunded`.
    function refund() external;
}
