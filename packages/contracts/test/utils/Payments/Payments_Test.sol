// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Base_Test } from "../../Base.t.sol";
import { IPayments } from "../../../src/interfaces/IPayments.sol";
import { Payments } from "../../../src/money/Payments.sol";

/// @notice The shared Payments fixture for unit, fuzz and invariant tests: Payments deployed, every
/// person and the company Safe approved for every token, and item builders whose ids follow the
/// spec's formula (spec/payments.md), computed here, independently of `Payments.paymentId`.
abstract contract Payments_Test is Base_Test {
    /// @dev spec/payments.md: unchanged from beta V3 so ids stay comparable.
    bytes32 internal constant PAYMENT_TYPEHASH = keccak256(
        "CapxulPayment(uint256 chainId,address router,bytes32 jobNonce,address executor,address recipient,address token,uint256 amount,uint16 kind,bytes32 documentHash)"
    );
    bytes32 internal constant DOCUMENT_HASH = keccak256("invoice 2026-001");
    bytes32 internal constant JOB_NONCE = keccak256("job 1");
    uint16 internal constant KIND_INVOICE = 1;
    uint256 internal constant AMOUNT = 100 * USDC_UNIT;

    Payments internal payments;

    function _deployProtocol() internal virtual override {
        payments = new Payments();
        vm.label(address(payments), "Payments");
        address[8] memory payers = [
            address(users.amira),
            users.ben,
            users.jordan,
            users.alice,
            users.bob,
            users.investor,
            users.eve,
            address(safe)
        ];
        for (uint256 i; i < payers.length; ++i) {
            _approveAll(payers[i]);
        }
    }

    /// @dev `account` lets Payments pull every test token without limit.
    function _approveAll(address account) internal {
        vm.startPrank(account);
        usdc.approve(address(payments), type(uint256).max);
        dai.approve(address(payments), type(uint256).max);
        usdt.approve(address(payments), type(uint256).max);
        falseToken.approve(address(payments), type(uint256).max);
        feeToken.approve(address(payments), type(uint256).max);
        rebasingToken.approve(address(payments), type(uint256).max);
        reentrantToken.approve(address(payments), type(uint256).max);
        vm.stopPrank();
    }

    /// @dev An invoice from anyone to `recipient`, with its id set by the spec formula.
    function _item(
        address recipient,
        address token,
        uint256 amount
    )
        internal
        view
        returns (IPayments.PaymentItem memory item)
    {
        item = IPayments.PaymentItem({
            paymentId: bytes32(0),
            recipient: recipient,
            token: token,
            amount: amount,
            kind: KIND_INVOICE,
            documentHash: DOCUMENT_HASH,
            jobNonce: JOB_NONCE,
            executor: address(0)
        });
        item.paymentId = _id(item);
    }

    /// @dev `_item` with its own job nonce, so several items can be paid.
    function _item(
        address recipient,
        address token,
        uint256 amount,
        bytes32 jobNonce
    )
        internal
        view
        returns (IPayments.PaymentItem memory item)
    {
        item = _item(recipient, token, amount);
        item.jobNonce = jobNonce;
        item.paymentId = _id(item);
    }

    /// @dev The spec's id for this chain and this Payments.
    function _id(IPayments.PaymentItem memory item) internal view returns (bytes32) {
        return _idAt(item, block.chainid, address(payments));
    }

    /// @dev The spec's id formula, for any chain and router.
    function _idAt(IPayments.PaymentItem memory item, uint256 chainId, address router) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                PAYMENT_TYPEHASH,
                chainId,
                router,
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

    /// @dev The rebasing mock's arithmetic: what `to` receives when `amount` moves to it.
    function _rebasingReceived(address to, uint256 amount) internal view returns (uint256) {
        uint256 index = rebasingToken.index();
        uint256 shares = rebasingToken.sharesOf(to);
        uint256 moved = amount * 1e18 / index;
        return (shares + moved) * index / 1e18 - shares * index / 1e18;
    }

    function _one(IPayments.PaymentItem memory item) internal pure returns (IPayments.PaymentItem[] memory items) {
        items = new IPayments.PaymentItem[](1);
        items[0] = item;
    }
}
