// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IPayments } from "../interfaces/IPayments.sol";

/// @title Payments
/// @notice The one way money moves (docs/planning/protocol-v4/spec/payments.md). Ports beta
/// CapxulPaymentsV3 with the renames (`settlementId` to `paymentId`, `settled` to `paid`) and the D9
/// guard (a recipient equal to this contract reverts `InvalidRecipient`; ids do not move).
/// @dev The reentrancy lock, the revert-data bubbling and the `TokenCallReturnedFalse` error are
/// protocol-specific, so OpenZeppelin's ReentrancyGuard and SafeERC20 (different errors) are not used.
contract Payments is IPayments {
    bytes32 private constant PAYMENT_TYPEHASH = keccak256(
        "CapxulPayment(uint256 chainId,address router,bytes32 jobNonce,address executor,address recipient,address token,uint256 amount,uint16 kind,bytes32 documentHash)"
    );

    /// @inheritdoc IPayments
    mapping(bytes32 => bool) public paid;

    bool private _entered;

    modifier nonReentrant() {
        if (_entered) revert ReentrantCall();
        _entered = true;
        _;
        _entered = false;
    }

    /// @inheritdoc IPayments
    function paymentId(PaymentItem calldata item) external view returns (bytes32) {
        return _paymentId(item);
    }

    /// @inheritdoc IPayments
    function send(PaymentItem calldata item) external nonReentrant {
        _send(item);
    }

    /// @inheritdoc IPayments
    function sendBatch(PaymentItem[] calldata items) external nonReentrant {
        for (uint256 i; i < items.length; ++i) {
            _send(items[i]);
        }
    }

    // _send runs once per batch item; the loop lints and the checks-effects-interactions lints below are
    // intended: the lock and the early `paid` write cover reentry (spec P8), and events follow the exact check.
    // forge-lint: disable-start(calls-loop, require-revert-in-loop, reentrancy-events, reentrancy-no-eth)
    function _send(PaymentItem calldata item) private {
        if (item.recipient == address(0) || item.token == address(0)) revert ZeroAddress();
        if (item.recipient == address(this)) revert InvalidRecipient();
        if (item.amount == 0) revert ZeroAmount();
        if (item.paymentId == bytes32(0)) revert ZeroPaymentId();
        if (item.documentHash == bytes32(0)) revert ZeroDocumentHash();
        if (item.jobNonce == bytes32(0)) revert ZeroJobNonce();

        bytes32 expected = _paymentId(item);
        if (item.paymentId != expected) revert PaymentIdMismatch(expected, item.paymentId);
        if (item.executor != address(0) && item.executor != msg.sender) {
            revert InvalidExecutor(item.executor, msg.sender);
        }
        if (paid[expected]) revert PaymentIdConsumed(expected);
        if (item.token.code.length == 0) revert TokenHasNoCode(item.token);

        paid[expected] = true;
        uint256 balanceBefore = IERC20(item.token).balanceOf(item.recipient);
        _transferFrom(item.token, item.recipient, item.amount);
        uint256 balanceAfter = IERC20(item.token).balanceOf(item.recipient);
        uint256 wanted = item.recipient == msg.sender ? 0 : item.amount;
        uint256 received = balanceAfter >= balanceBefore ? balanceAfter - balanceBefore : 0;
        if (received != wanted || (wanted == 0 && balanceAfter != balanceBefore)) {
            revert InexactTransfer(item.token, wanted, received);
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

    function _transferFrom(address token, address to, uint256 amount) private {
        (bool success, bytes memory result) = token.call(abi.encodeCall(IERC20.transferFrom, (msg.sender, to, amount)));
        if (!success) {
            assembly ("memory-safe") {
                revert(add(result, 32), mload(result))
            }
        }
        if (result.length != 0 && !abi.decode(result, (bool))) revert TokenCallReturnedFalse(token);
    }
    // forge-lint: disable-end
}
