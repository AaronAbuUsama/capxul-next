// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title CapxulPaymentsV3
/// @notice Routes exact payments and records their self-authenticating identity.
contract CapxulPaymentsV3 {
    bytes32 private constant PAYMENT_TYPEHASH = keccak256(
        "CapxulPayment(uint256 chainId,address router,bytes32 jobNonce,address executor,address recipient,address token,uint256 amount,uint16 kind,bytes32 documentHash)"
    );

    struct PaymentItem {
        bytes32 settlementId;
        address recipient;
        address token;
        uint256 amount;
        uint16 kind;
        bytes32 documentHash;
        bytes32 jobNonce;
        address executor;
    }

    mapping(bytes32 => bool) public settled;
    bool private _entered;

    event PaymentSent(
        bytes32 indexed settlementId,
        address indexed sender,
        address indexed recipient,
        address token,
        uint256 amount,
        uint16 kind,
        bytes32 documentHash
    );

    error ZeroAmount();
    error ZeroAddress();
    error ZeroSettlementId();
    error ZeroDocumentHash();
    error ZeroJobNonce();
    error PaymentIdMismatch(bytes32 expected, bytes32 supplied);
    error InvalidExecutor(address expected, address supplied);
    error SettlementIdConsumed(bytes32 settlementId);
    error TokenHasNoCode(address token);
    error TokenCallReturnedFalse(address token);
    error InexactTransfer(address token, uint256 expected, uint256 received);
    error ReentrantCall();

    modifier nonReentrant() {
        if (_entered) revert ReentrantCall();
        _entered = true;
        _;
        _entered = false;
    }

    /// @notice Returns the identity for the exact payment terms on this router and chain.
    function paymentId(PaymentItem calldata item) external view returns (bytes32) {
        return _paymentId(item);
    }

    /// @notice Transfers one exact payment from the caller to the fixed recipient.
    function send(PaymentItem calldata item) external nonReentrant {
        _send(item);
    }

    /// @notice Transfers each exact payment atomically in input order.
    function sendBatch(PaymentItem[] calldata items) external nonReentrant {
        for (uint256 index; index < items.length; ++index) {
            _send(items[index]);
        }
    }

    function _send(PaymentItem calldata item) private {
        _validate(item);
        bytes32 expected = _paymentId(item);
        if (item.settlementId != expected) revert PaymentIdMismatch(expected, item.settlementId);
        if (item.executor != address(0) && item.executor != msg.sender) {
            revert InvalidExecutor(item.executor, msg.sender);
        }
        if (settled[expected]) revert SettlementIdConsumed(expected);
        if (item.token.code.length == 0) revert TokenHasNoCode(item.token);

        settled[expected] = true;
        uint256 beforeBalance = IERC20(item.token).balanceOf(item.recipient);
        _callToken(item.token, abi.encodeCall(IERC20.transferFrom, (msg.sender, item.recipient, item.amount)));
        uint256 afterBalance = IERC20(item.token).balanceOf(item.recipient);
        uint256 expectedIncrease = item.recipient == msg.sender ? 0 : item.amount;
        uint256 received = afterBalance >= beforeBalance ? afterBalance - beforeBalance : 0;
        if (received != expectedIncrease || (expectedIncrease == 0 && afterBalance != beforeBalance)) {
            revert InexactTransfer(item.token, expectedIncrease, received);
        }

        emit PaymentSent(expected, msg.sender, item.recipient, item.token, item.amount, item.kind, item.documentHash);
    }

    function _paymentId(PaymentItem calldata item) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                PAYMENT_TYPEHASH,
                block.chainid,
                address(this),
                item.jobNonce,
                item.executor,
                item.recipient,
                item.token,
                item.amount,
                item.kind,
                item.documentHash
            )
        );
    }

    function _validate(PaymentItem calldata item) private pure {
        if (item.recipient == address(0) || item.token == address(0)) revert ZeroAddress();
        if (item.amount == 0) revert ZeroAmount();
        if (item.settlementId == bytes32(0)) revert ZeroSettlementId();
        if (item.documentHash == bytes32(0)) revert ZeroDocumentHash();
        if (item.jobNonce == bytes32(0)) revert ZeroJobNonce();
    }

    function _callToken(address token, bytes memory data) private {
        if (token.code.length == 0) revert TokenHasNoCode(token);
        (bool success, bytes memory result) = token.call(data);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(result, 32), mload(result))
            }
        }
        if (result.length != 0 && !abi.decode(result, (bool))) revert TokenCallReturnedFalse(token);
    }
}
