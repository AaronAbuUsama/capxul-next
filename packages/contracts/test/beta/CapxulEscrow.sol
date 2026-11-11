// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { CapxulPaymentsV3 } from "./CapxulPaymentsV3.sol";

/// @title CapxulEscrow
/// @notice Holds one fixed payment until its fixed release condition is met.
contract CapxulEscrow {
    uint8 public constant CONDITION_INVOICE_AMOUNT_REACHED = 0;
    uint8 public constant CONDITION_PAYEE_CLAIMED = 1;

    enum State {
        Open,
        Paid,
        Refunded
    }

    struct Terms {
        address ownerSafe;
        address payeeSafe;
        address token;
        uint256 amount;
        bytes32 jobNonce;
        uint16 kind;
        bytes32 documentHash;
        uint8 condition;
    }

    address public immutable ownerSafe;
    address public immutable payeeSafe;
    address public immutable token;
    uint256 public immutable amount;
    bytes32 public immutable settlementId;
    bytes32 public immutable jobNonce;
    uint16 public immutable kind;
    bytes32 public immutable documentHash;
    uint8 public immutable condition;
    CapxulPaymentsV3 public immutable payments;
    address public immutable bootstrapOwner;

    State public state;
    bool private _entered;

    event EscrowCreated(
        address indexed ownerSafe,
        address indexed payeeSafe,
        bytes32 indexed settlementId,
        address token,
        uint256 amount,
        uint16 kind,
        bytes32 documentHash,
        uint8 condition
    );
    event EscrowPaid(
        address indexed ownerSafe, address indexed payeeSafe, bytes32 indexed settlementId, uint256 amount
    );
    event EscrowRefunded(address indexed ownerSafe, bytes32 indexed settlementId, uint256 amount, State state);
    event InvoiceSettlementCompleted(
        address indexed ownerSafe, address indexed payeeSafe, bytes32 indexed settlementId, uint256 surplus
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

    modifier nonReentrant() {
        if (_entered) revert ReentrantCall();
        _entered = true;
        _;
        _entered = false;
    }

    constructor(Terms memory terms, address payments_, address bootstrapOwner_) {
        _validate(terms);
        if (payments_ == address(0) || bootstrapOwner_ == address(0)) revert ZeroAddress();

        ownerSafe = terms.ownerSafe;
        payeeSafe = terms.payeeSafe;
        token = terms.token;
        amount = terms.amount;
        jobNonce = terms.jobNonce;
        kind = terms.kind;
        documentHash = terms.documentHash;
        condition = terms.condition;
        payments = CapxulPaymentsV3(payments_);
        bootstrapOwner = bootstrapOwner_;

        CapxulPaymentsV3.PaymentItem memory item = _paymentItem();
        settlementId = CapxulPaymentsV3(payments_).paymentId(item);

        emit EscrowCreated(
            terms.ownerSafe,
            terms.payeeSafe,
            settlementId,
            terms.token,
            terms.amount,
            terms.kind,
            terms.documentHash,
            terms.condition
        );
    }

    /// @notice Returns true when the fixed release condition is met.
    function conditionMet() public view returns (bool) {
        if (condition == CONDITION_INVOICE_AMOUNT_REACHED) {
            return IERC20(token).balanceOf(address(this)) >= amount;
        }
        if (payeeSafe.code.length == 0) return false;
        (bool success, bytes memory result) = payeeSafe.staticcall(abi.encodeWithSignature("getOwners()"));
        if (!success || result.length < 96) return false;
        uint256 offset;
        uint256 length;
        uint256 ownerWord;
        assembly ("memory-safe") {
            offset := mload(add(result, 32))
            length := mload(add(result, 64))
            ownerWord := mload(add(result, 96))
        }
        if (offset != 32 || length != 1 || ownerWord > type(uint160).max) return false;
        return address(uint160(ownerWord)) != bootstrapOwner;
    }

    /// @notice Pays an invoice after its condition is met.
    function payout() external nonReentrant {
        if (condition != CONDITION_INVOICE_AMOUNT_REACHED) revert InvalidCondition(condition);
        _payout();
    }

    /// @notice Lets the claimed payee Safe collect its fixed payment.
    function collect() external nonReentrant {
        if (condition != CONDITION_PAYEE_CLAIMED) revert InvalidCondition(condition);
        if (msg.sender != payeeSafe) revert NotPayee();
        _payout();
    }

    function _payout() private {
        if (state != State.Open) revert JobNotOpen();
        if (condition == CONDITION_INVOICE_AMOUNT_REACHED && payments.settled(settlementId)) {
            state = State.Paid;
            uint256 settledSurplus = IERC20(token).balanceOf(address(this));
            if (settledSurplus != 0) _safeTransfer(ownerSafe, settledSurplus);
            emit InvoiceSettlementCompleted(ownerSafe, payeeSafe, settlementId, settledSurplus);
            return;
        }
        if (!conditionMet()) revert ConditionNotMet();
        if (IERC20(token).balanceOf(address(this)) < amount) revert InsufficientFunding();

        state = State.Paid;
        _callToken(abi.encodeCall(IERC20.approve, (address(payments), amount)));
        payments.send(
            CapxulPaymentsV3.PaymentItem({
                settlementId: settlementId,
                recipient: payeeSafe,
                token: token,
                amount: amount,
                kind: kind,
                documentHash: documentHash,
                jobNonce: jobNonce,
                executor: condition == CONDITION_PAYEE_CLAIMED ? address(this) : address(0)
            })
        );

        uint256 surplus = IERC20(token).balanceOf(address(this));
        if (surplus != 0) _safeTransfer(ownerSafe, surplus);
        emit EscrowPaid(ownerSafe, payeeSafe, settlementId, amount);
    }

    /// @notice Returns configured-token funds to the fixed owner.
    function refund() external nonReentrant {
        if (msg.sender != ownerSafe) revert NotOwner();
        if (state == State.Open) {
            if (condition == CONDITION_INVOICE_AMOUNT_REACHED && conditionMet()) revert ConditionMet();
            state = State.Refunded;
        }

        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance != 0) _safeTransfer(ownerSafe, balance);
        emit EscrowRefunded(ownerSafe, settlementId, balance, state);
    }

    function _safeTransfer(address recipient, uint256 value) private {
        _callToken(abi.encodeCall(IERC20.transfer, (recipient, value)));
    }

    function _callToken(bytes memory data) private {
        if (token.code.length == 0) revert TokenHasNoCode(token);
        (bool success, bytes memory result) = token.call(data);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(result, 32), mload(result))
            }
        }
        if (result.length != 0 && !abi.decode(result, (bool))) revert TokenCallReturnedFalse(token);
    }

    function _validate(Terms memory terms) private pure {
        if (terms.ownerSafe == address(0) || terms.payeeSafe == address(0) || terms.token == address(0)) {
            revert ZeroAddress();
        }
        if (terms.amount == 0) revert ZeroAmount();
        if (terms.jobNonce == bytes32(0)) revert ZeroJobNonce();
        if (terms.documentHash == bytes32(0)) revert ZeroDocumentHash();
        if (terms.condition > CONDITION_PAYEE_CLAIMED) revert InvalidCondition(terms.condition);
    }

    function _paymentItem() private view returns (CapxulPaymentsV3.PaymentItem memory) {
        return CapxulPaymentsV3.PaymentItem({
            settlementId: bytes32(uint256(1)),
            recipient: payeeSafe,
            token: token,
            amount: amount,
            kind: kind,
            documentHash: documentHash,
            jobNonce: jobNonce,
            executor: condition == CONDITION_PAYEE_CLAIMED ? address(this) : address(0)
        });
    }
}
