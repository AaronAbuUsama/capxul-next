// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IEscrow } from "../interfaces/IEscrow.sol";
import { IPayments } from "../interfaces/IPayments.sol";

/// @title Escrow
/// @notice Holds one fixed payment until its fixed release condition is met (spec/escrow.md). Ported from
/// beta `CapxulEscrow` with the v4 renames and the D11 claim condition.
contract Escrow is IEscrow {
    error InsufficientGasForExitIdentity();

    /// @dev Exit payouts use kind 8; the owner must also confirm that this escrow is an exit claim.
    uint16 private constant KIND_EXIT = 8;
    /// @inheritdoc IEscrow
    uint8 public constant CONDITION_INVOICE_AMOUNT_REACHED = 0;
    /// @inheritdoc IEscrow
    uint8 public constant CONDITION_PAYEE_CLAIMED = 1;

    /// @inheritdoc IEscrow
    address public immutable ownerSafe;
    /// @inheritdoc IEscrow
    address public immutable payeeSafe;
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
    IPayments public immutable payments;
    /// @inheritdoc IEscrow
    address public immutable bootstrapOwner;

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
    /// @param bootstrapOwner_ The chain's Companies House Safe.
    constructor(Terms memory terms, address payments_, address bootstrapOwner_) {
        if (terms.ownerSafe == address(0) || terms.payeeSafe == address(0) || terms.token == address(0)) {
            revert ZeroAddress();
        }
        if (terms.amount == 0) revert ZeroAmount();
        if (terms.jobNonce == bytes32(0)) revert ZeroJobNonce();
        if (terms.documentHash == bytes32(0)) revert ZeroDocumentHash();
        if (terms.condition > CONDITION_PAYEE_CLAIMED) revert InvalidCondition(terms.condition);
        if (payments_ == address(0) || bootstrapOwner_ == address(0)) revert ZeroAddress();

        ownerSafe = terms.ownerSafe;
        payeeSafe = terms.payeeSafe;
        token = terms.token;
        amount = terms.amount;
        jobNonce = terms.jobNonce;
        kind = terms.kind;
        documentHash = terms.documentHash;
        condition = terms.condition;
        payments = IPayments(payments_);
        bootstrapOwner = bootstrapOwner_;

        // The id excludes `paymentId`, so any placeholder works; the immutable is not readable yet.
        IPayments.PaymentItem memory item = _item(bytes32(uint256(1)), terms, address(this));
        bytes32 id = IPayments(payments_).paymentId(item);
        paymentId = id;

        emit EscrowCreated(
            terms.ownerSafe,
            terms.payeeSafe,
            id,
            terms.token,
            terms.amount,
            terms.kind,
            terms.documentHash,
            terms.condition
        );
    }

    /// @inheritdoc IEscrow
    function conditionMet() public view returns (bool) {
        if (condition == CONDITION_INVOICE_AMOUNT_REACHED) {
            return IERC20(token).balanceOf(address(this)) >= amount;
        }
        if (payeeSafe.code.length == 0) return false;
        (bool ok, bytes memory r) = payeeSafe.staticcall(abi.encodeWithSignature("isOwner(address)", bootstrapOwner));
        if (!ok || r.length != 32) return false;
        // Only an exact `false` counts as claimed; any other word fails closed.
        return abi.decode(r, (uint256)) == 0;
    }

    /// @inheritdoc IEscrow
    function payout() external nonReentrant {
        if (condition != CONDITION_INVOICE_AMOUNT_REACHED) revert InvalidCondition(condition);
        _payout();
    }

    /// @inheritdoc IEscrow
    function collect() external nonReentrant {
        if (condition != CONDITION_PAYEE_CLAIMED) revert InvalidCondition(condition);
        if (msg.sender != payeeSafe) revert NotPayee();
        _payout();
    }

    function _payout() private {
        if (state != State.Open) revert JobNotOpen();
        if (condition == CONDITION_INVOICE_AMOUNT_REACHED && payments.paid(paymentId)) {
            state = State.Paid;
            uint256 surplus_ = IERC20(token).balanceOf(address(this));
            if (surplus_ != 0) _callToken(abi.encodeCall(IERC20.transfer, (ownerSafe, surplus_)));
            // forge-lint: disable-next-line(reentrancy-events)
            emit InvoicePaymentCompleted(ownerSafe, payeeSafe, paymentId, surplus_);
            return;
        }
        if (!conditionMet()) revert ConditionNotMet();
        uint256 funded = IERC20(token).balanceOf(address(this));
        if (funded < amount) revert InsufficientFunding();

        state = State.Paid;
        _callToken(abi.encodeCall(IERC20.approve, (address(payments), amount)));
        IPayments.PaymentItem memory item = IPayments.PaymentItem({
            paymentId: paymentId,
            recipient: payeeSafe,
            token: token,
            amount: amount,
            kind: kind,
            documentHash: documentHash,
            jobNonce: jobNonce,
            executor: condition == CONDITION_PAYEE_CLAIMED ? address(this) : address(0)
        });
        // forge-lint: disable-next-line(reentrancy-no-eth)
        payments.send(item);

        uint256 surplus = IERC20(token).balanceOf(address(this));
        bool exitClaim = condition == CONDITION_PAYEE_CLAIMED && kind == KIND_EXIT && (funded != amount || surplus != 0)
            && _isExitClaim();
        if (exitClaim) {
            uint256 spent = funded >= surplus ? funded - surplus : 0;
            if (spent != amount) revert IPayments.InexactTransfer(token, amount, spent);
        }
        if (surplus != 0) {
            address surplusRecipient = exitClaim ? payeeSafe : ownerSafe;
            uint256 before = exitClaim ? IERC20(token).balanceOf(surplusRecipient) : 0;
            _callToken(abi.encodeCall(IERC20.transfer, (surplusRecipient, surplus)));
            if (exitClaim) {
                uint256 after_ = IERC20(token).balanceOf(surplusRecipient);
                uint256 received = after_ >= before ? after_ - before : 0;
                if (received != surplus) revert IPayments.InexactTransfer(token, surplus, received);
                uint256 remaining = IERC20(token).balanceOf(address(this));
                uint256 spent = surplus >= remaining ? surplus - remaining : 0;
                if (spent != surplus) revert IPayments.InexactTransfer(token, surplus, spent);
            }
        }
        // forge-lint: disable-next-line(reentrancy-events)
        emit EscrowPaid(ownerSafe, payeeSafe, paymentId, amount);
    }

    /// @inheritdoc IEscrow
    function refund() external nonReentrant {
        if (msg.sender != ownerSafe) revert NotOwner();
        if (state == State.Open) {
            if (condition == CONDITION_INVOICE_AMOUNT_REACHED && conditionMet()) revert ConditionMet();
            state = State.Refunded;
        }
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance != 0) _callToken(abi.encodeCall(IERC20.transfer, (ownerSafe, balance)));
        // forge-lint: disable-next-line(reentrancy-events)
        emit EscrowRefunded(ownerSafe, paymentId, balance, state);
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

    /// @dev An exit payout's label alone is not an identity: ordinary escrows can use any payment kind.
    function _isExitClaim() private view returns (bool) {
        bytes memory data = abi.encodeWithSignature("isExitClaimEscrow(address)", address(this));
        address owner = ownerSafe;
        // Do not treat a gas-starved lookup as an ordinary escrow and misroute the surplus.
        if (gasleft() < 30_000) revert InsufficientGasForExitIdentity();
        bool ok;
        uint256 size;
        uint256 value;
        // Copy at most one word, even if the owner returns a large response.
        assembly ("memory-safe") {
            let output := mload(0x40)
            ok := staticcall(15000, owner, add(data, 0x20), mload(data), output, 0x20)
            size := returndatasize()
            value := mload(output)
        }
        return ok && size == 32 && value == 1;
    }

    function _item(
        bytes32 id,
        Terms memory t,
        address executorIfClaim
    )
        private
        pure
        returns (IPayments.PaymentItem memory)
    {
        return IPayments.PaymentItem({
            paymentId: id,
            recipient: t.payeeSafe,
            token: t.token,
            amount: t.amount,
            kind: t.kind,
            documentHash: t.documentHash,
            jobNonce: t.jobNonce,
            executor: t.condition == CONDITION_PAYEE_CLAIMED ? executorIfClaim : address(0)
        });
    }
}
