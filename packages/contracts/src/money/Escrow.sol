// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IEscrow } from "../interfaces/IEscrow.sol";
import { IPayments } from "../interfaces/IPayments.sol";

/// @title Escrow
/// @notice The general escrow (aaron.escrow-general): one fixed payment for an owner that may not exist yet,
/// collected by the owner whenever it can act, or taken back to the sender until then. v4's escrow with its roles
/// named for what they do (`ownerSafe` is `sender`, `payeeSafe` is `owner`), the authority term, the bootstrap
/// owner as a term, `ownerTakesSurplus` in place of the exit-claim lookup, `canRefund`, and `by` on
/// `EscrowRefunded`. It reads no clock: there is no expiry.
contract Escrow is IEscrow {
    /// @inheritdoc IEscrow
    uint8 public constant CONDITION_AMOUNT_REACHED = 0;
    /// @inheritdoc IEscrow
    uint8 public constant CONDITION_OWNER_COLLECTS = 1;

    /// @inheritdoc IEscrow
    address public immutable owner;
    /// @inheritdoc IEscrow
    address public immutable sender;
    /// @inheritdoc IEscrow
    address public immutable authority;
    /// @inheritdoc IEscrow
    uint256 public immutable authorityKey;
    /// @inheritdoc IEscrow
    address public immutable bootstrapOwner;
    /// @inheritdoc IEscrow
    address public immutable token;
    /// @inheritdoc IEscrow
    uint256 public immutable amount;
    /// @inheritdoc IEscrow
    bytes32 public immutable paymentId;
    /// @inheritdoc IEscrow
    bytes32 public immutable jobNonce;
    /// @inheritdoc IEscrow
    uint16 public immutable kind;
    /// @inheritdoc IEscrow
    bytes32 public immutable documentHash;
    /// @inheritdoc IEscrow
    uint8 public immutable condition;
    /// @inheritdoc IEscrow
    bool public immutable ownerTakesSurplus;
    /// @inheritdoc IEscrow
    IPayments public immutable payments;

    /// @inheritdoc IEscrow
    State public state;
    bool private _entered;

    modifier nonReentrant() {
        if (_entered) revert ReentrantCall();
        _entered = true;
        _;
        _entered = false;
    }

    /// @param terms The escrow's terms.
    /// @param payments_ The Payments contract.
    constructor(Terms memory terms, address payments_) {
        if (terms.owner == address(0) || terms.sender == address(0) || terms.token == address(0)) {
            revert ZeroAddress();
        }
        if (terms.amount == 0) revert ZeroAmount();
        if (terms.jobNonce == bytes32(0)) revert ZeroJobNonce();
        if (terms.documentHash == bytes32(0)) revert ZeroDocumentHash();
        if (terms.condition > CONDITION_OWNER_COLLECTS) revert InvalidCondition(terms.condition);
        if (payments_ == address(0)) revert ZeroAddress();

        owner = terms.owner;
        sender = terms.sender;
        authority = terms.authority;
        authorityKey = terms.authorityKey;
        bootstrapOwner = terms.bootstrapOwner;
        token = terms.token;
        amount = terms.amount;
        jobNonce = terms.jobNonce;
        kind = terms.kind;
        documentHash = terms.documentHash;
        condition = terms.condition;
        ownerTakesSurplus = terms.ownerTakesSurplus;
        payments = IPayments(payments_);

        // The id excludes `paymentId`, so any placeholder works; the immutable is not readable yet.
        bytes32 id = IPayments(payments_).paymentId(_item(bytes32(uint256(1)), terms, address(this)));
        paymentId = id;

        emit EscrowCreated(
            terms.owner,
            terms.sender,
            id,
            terms.token,
            terms.amount,
            terms.kind,
            terms.documentHash,
            terms.condition,
            terms.authority,
            terms.authorityKey
        );
    }

    /// @inheritdoc IEscrow
    function conditionMet() public view returns (bool) {
        if (condition == CONDITION_AMOUNT_REACHED) {
            return IERC20(token).balanceOf(address(this)) >= amount;
        }
        if (bootstrapOwner == address(0)) return true;
        (bool ok, uint256 word) =
            _readWord(owner, abi.encodeWithSignature("isOwner(address)", bootstrapOwner));
        // Only an exact `false` counts as "no longer an owner"; any other answer fails closed (D11).
        return ok && word == 0;
    }

    /// @inheritdoc IEscrow
    function canRefund(address who) public view returns (bool) {
        if (who == sender) return true;
        if (authority == address(0)) return false;
        (bool ok, uint256 word) =
            _readWord(authority, abi.encodeWithSignature("authorised(uint256,address)", authorityKey, who));
        // Only an exact `true` admits; a revert or any other answer refuses.
        return ok && word == 1;
    }

    /// @inheritdoc IEscrow
    function payout() external nonReentrant {
        if (condition != CONDITION_AMOUNT_REACHED) revert InvalidCondition(condition);
        if (state != State.Open) revert JobNotOpen();
        if (payments.paid(paymentId)) {
            // The invoice item was paid through Payments by someone else: close, and return what is here.
            state = State.Paid;
            uint256 balance = IERC20(token).balanceOf(address(this));
            if (balance != 0) _callToken(abi.encodeCall(IERC20.transfer, (sender, balance)));
            // forge-lint: disable-next-line(reentrancy-events)
            emit InvoicePaymentCompleted(owner, sender, paymentId, balance);
            return;
        }
        if (!conditionMet()) revert ConditionNotMet();
        _pay(false);
    }

    /// @inheritdoc IEscrow
    function collect() external nonReentrant {
        if (condition != CONDITION_OWNER_COLLECTS) revert InvalidCondition(condition);
        if (msg.sender != owner) revert NotOwner();
        if (state != State.Open) revert JobNotOpen();
        if (!conditionMet()) revert ConditionNotMet();
        _pay(ownerTakesSurplus);
    }

    /// @dev Pays exactly `amount` to the owner through Payments, then the surplus to the sender, or to the owner
    /// when `surplusToOwner`. The state is `Paid` before any token moves.
    function _pay(bool surplusToOwner) private {
        uint256 funded = IERC20(token).balanceOf(address(this));
        if (funded < amount) revert InsufficientFunding();

        state = State.Paid;
        _callToken(abi.encodeCall(IERC20.approve, (address(payments), amount)));
        // forge-lint: disable-next-line(reentrancy-no-eth)
        payments.send(_item(paymentId, _terms(), address(this)));

        uint256 surplus = IERC20(token).balanceOf(address(this));
        if (surplusToOwner && (funded != amount || surplus != 0)) {
            // The owner's whole share must leave exactly: an inexact token cannot misroute it (v4's exit claim).
            uint256 spent = funded >= surplus ? funded - surplus : 0;
            if (spent != amount) revert IPayments.InexactTransfer(token, amount, spent);
        }
        if (surplus != 0) {
            address to = surplusToOwner ? owner : sender;
            uint256 before = surplusToOwner ? IERC20(token).balanceOf(to) : 0;
            _callToken(abi.encodeCall(IERC20.transfer, (to, surplus)));
            if (surplusToOwner) {
                uint256 after_ = IERC20(token).balanceOf(to);
                uint256 received = after_ >= before ? after_ - before : 0;
                if (received != surplus) revert IPayments.InexactTransfer(token, surplus, received);
                uint256 remaining = IERC20(token).balanceOf(address(this));
                uint256 spent = surplus >= remaining ? surplus - remaining : 0;
                if (spent != surplus) revert IPayments.InexactTransfer(token, surplus, spent);
            }
        }
        // forge-lint: disable-next-line(reentrancy-events)
        emit EscrowPaid(owner, sender, paymentId, amount);
    }

    /// @inheritdoc IEscrow
    function refund() external nonReentrant {
        if (!canRefund(msg.sender)) revert CannotRefund(msg.sender);
        if (state == State.Open) {
            if (condition == CONDITION_AMOUNT_REACHED && conditionMet()) revert ConditionMet();
            state = State.Refunded;
        }
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance != 0) _callToken(abi.encodeCall(IERC20.transfer, (sender, balance)));
        // forge-lint: disable-next-line(reentrancy-events)
        emit EscrowRefunded(sender, msg.sender, paymentId, balance, state);
    }

    function _callToken(bytes memory data) private {
        if (token.code.length == 0) revert TokenHasNoCode(token);
        // forge-lint: disable-next-line(reentrancy-no-eth)
        (bool ok, bytes memory result) = token.call(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(result, 32), mload(result))
            }
        }
        if (result.length != 0 && !abi.decode(result, (bool))) revert TokenCallReturnedFalse(token);
    }

    /// @dev A static call that counts only an answer of exactly one word. It copies at most one word, so a
    /// target that answers with a huge return cannot make the caller run out of memory gas.
    function _readWord(address target, bytes memory data) private view returns (bool ok, uint256 word) {
        if (target.code.length == 0) return (false, 0);
        uint256 size;
        assembly ("memory-safe") {
            let output := mload(0x40)
            ok := staticcall(gas(), target, add(data, 0x20), mload(data), output, 0x20)
            size := returndatasize()
            word := mload(output)
        }
        ok = ok && size == 32;
    }

    function _terms() private view returns (Terms memory) {
        return Terms({
            owner: owner,
            sender: sender,
            authority: authority,
            authorityKey: authorityKey,
            bootstrapOwner: bootstrapOwner,
            token: token,
            amount: amount,
            jobNonce: jobNonce,
            kind: kind,
            documentHash: documentHash,
            condition: condition,
            ownerTakesSurplus: ownerTakesSurplus
        });
    }

    function _item(
        bytes32 id,
        Terms memory t,
        address escrow
    )
        private
        pure
        returns (IPayments.PaymentItem memory)
    {
        return IPayments.PaymentItem({
            paymentId: id,
            recipient: t.owner,
            token: t.token,
            amount: t.amount,
            kind: t.kind,
            documentHash: t.documentHash,
            jobNonce: t.jobNonce,
            executor: t.condition == CONDITION_OWNER_COLLECTS ? escrow : address(0)
        });
    }
}
