// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";

import { IPayments } from "../../../src/interfaces/IPayments.sol";
import { PaymentsHandler } from "./PaymentsHandler.sol";

/// @notice Eve, who wears nothing and calls everything. Each attack is made with `try`; the refusal is
/// asserted to be the exact error the spec names, and any success sets `eveWon`, which the suite reads.
contract PaymentsAttackerHandler is Test {
    IPayments internal immutable payments;
    PaymentsHandler internal immutable honest;
    address internal immutable eve;
    address internal immutable usdc;

    bool public eveWon;
    mapping(bytes4 selector => uint256) public calls;

    constructor(IPayments payments_, PaymentsHandler honest_, address eve_, address usdc_) {
        payments = payments_;
        honest = honest_;
        eve = eve_;
        usdc = usdc_;
    }

    /// @dev P3, P5: replay an item that already paid, with every term unchanged.
    function replay(uint256 seed) external {
        calls[this.replay.selector]++;
        uint256 count = honest.sentItemCount();
        if (count == 0) return;
        IPayments.PaymentItem memory item = honest.sentItem(bound(seed, 0, count - 1));
        // An executor-bound item refuses Eve before the consumed check (spec validation order); any other
        // item is refused as already paid.
        _attack(
            item,
            item.executor == address(0)
                ? abi.encodeWithSelector(IPayments.PaymentIdConsumed.selector, item.paymentId)
                : abi.encodeWithSelector(IPayments.InvalidExecutor.selector, item.executor, eve)
        );
    }

    /// @dev P3, P5: Eve names herself as executor of an already-paid item; the id then no longer matches.
    function replayAsExecutor(uint256 seed) external {
        calls[this.replayAsExecutor.selector]++;
        uint256 count = honest.sentItemCount();
        if (count == 0) return;
        IPayments.PaymentItem memory item = honest.sentItem(bound(seed, 0, count - 1));
        bytes32 supplied = item.paymentId;
        item.executor = eve;
        _attack(item, abi.encodeWithSelector(IPayments.PaymentIdMismatch.selector, payments.paymentId(item), supplied));
    }

    /// @dev P4: keep a real id but redirect the money to Eve.
    function redirect(uint256 seed) external {
        calls[this.redirect.selector]++;
        uint256 count = honest.sentItemCount();
        if (count == 0) return;
        IPayments.PaymentItem memory item = honest.sentItem(bound(seed, 0, count - 1));
        bytes32 supplied = item.paymentId;
        item.recipient = eve;
        item.executor = address(0);
        _attack(item, abi.encodeWithSelector(IPayments.PaymentIdMismatch.selector, payments.paymentId(item), supplied));
    }

    /// @dev P7 (D9): pay Payments itself, with a correct id.
    function payPaymentsItself(uint256 amount, bytes32 jobNonce) external {
        calls[this.payPaymentsItself.selector]++;
        if (jobNonce == bytes32(0)) jobNonce = keccak256("eve");
        IPayments.PaymentItem memory item = IPayments.PaymentItem({
            paymentId: bytes32(0),
            recipient: address(payments),
            token: usdc,
            amount: bound(amount, 1, 1_000_000e6),
            kind: 0,
            documentHash: keccak256("eve's document"),
            jobNonce: jobNonce,
            executor: address(0)
        });
        item.paymentId = payments.paymentId(item);
        _attack(item, abi.encodeWithSelector(IPayments.InvalidRecipient.selector));
    }

    function _attack(IPayments.PaymentItem memory item, bytes memory expected) internal {
        vm.prank(eve);
        try payments.send(item) {
            eveWon = true;
        } catch (bytes memory reason) {
            assertEq(reason, expected, "Eve was refused for the wrong reason");
        }
    }
}
