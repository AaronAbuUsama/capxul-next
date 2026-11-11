// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC20Errors } from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

import { IPayments } from "../../../../../src/interfaces/IPayments.sol";
import { MockNoReturnToken } from "../../../../mocks/MockNoReturnToken.sol";
import { Payments_Test } from "../../../../utils/Payments/Payments_Test.sol";

/// @dev Ports beta `packages/contracts/test/unit/CapxulPaymentsV3.t.sol:46-140` and the V2-only cases of
/// `packages/contracts/test/unit/Payments.t.sol:164-251` onto Payments itself (research R2 PM1-PM10).
contract Send_Payments_Unit_Concrete_Test is Payments_Test {
    function test_WhenACallIntoPaymentsIsAlreadyRunning() external {
        // The token calls back send while the outer send is inside transferFrom.
        IPayments.PaymentItem memory inner = _item(users.bob, address(usdc), AMOUNT, keccak256("inner"));
        reentrantToken.arm(address(payments), abi.encodeCall(IPayments.send, (inner)));
        IPayments.PaymentItem memory outer = _item(users.alice, address(reentrantToken), AMOUNT);

        vm.prank(users.amira);
        payments.send(outer);

        // it should revert with ReentrantCall
        assertTrue(reentrantToken.reentered(), "the token re-entered");
        assertFalse(reentrantToken.reentrySucceeded(), "inner send refused");
        assertEq(reentrantToken.reentryResult(), abi.encodeWithSelector(IPayments.ReentrantCall.selector));
        assertFalse(payments.paid(inner.paymentId), "inner id unpaid");
        assertTrue(payments.paid(outer.paymentId), "outer id paid");
    }

    modifier whenNoCallIsRunning() {
        _;
    }

    function test_WhenTheRecipientOrTheTokenIsTheZeroAddress() external whenNoCallIsRunning {
        // it should revert with ZeroAddress
        IPayments.PaymentItem memory item = _item(address(0), address(usdc), AMOUNT);
        vm.prank(users.amira);
        vm.expectRevert(IPayments.ZeroAddress.selector);
        payments.send(item);

        item = _item(users.alice, address(0), AMOUNT);
        vm.prank(users.amira);
        vm.expectRevert(IPayments.ZeroAddress.selector);
        payments.send(item);
    }

    function test_WhenTheRecipientIsPaymentsItself() external whenNoCallIsRunning {
        // it should revert with InvalidRecipient (D9); the id is the spec's, so only the guard refuses it
        IPayments.PaymentItem memory item = _item(address(payments), address(usdc), AMOUNT);
        vm.prank(users.amira);
        vm.expectRevert(IPayments.InvalidRecipient.selector);
        payments.send(item);
        assertEq(usdc.balanceOf(address(payments)), 0, "nothing stranded in Payments");
    }

    function test_WhenTheAmountIs0() external whenNoCallIsRunning {
        // it should revert with ZeroAmount
        IPayments.PaymentItem memory item = _item(users.alice, address(usdc), 0);
        vm.prank(users.amira);
        vm.expectRevert(IPayments.ZeroAmount.selector);
        payments.send(item);
    }

    function test_WhenThePaymentIdIsZero() external whenNoCallIsRunning {
        // it should revert with ZeroPaymentId
        IPayments.PaymentItem memory item = _item(users.alice, address(usdc), AMOUNT);
        item.paymentId = bytes32(0);
        vm.prank(users.amira);
        vm.expectRevert(IPayments.ZeroPaymentId.selector);
        payments.send(item);
    }

    function test_WhenTheDocumentHashIsZero() external whenNoCallIsRunning {
        // it should revert with ZeroDocumentHash
        IPayments.PaymentItem memory item = _item(users.alice, address(usdc), AMOUNT);
        item.documentHash = bytes32(0);
        item.paymentId = _id(item);
        vm.prank(users.amira);
        vm.expectRevert(IPayments.ZeroDocumentHash.selector);
        payments.send(item);
    }

    function test_WhenTheJobNonceIsZero() external whenNoCallIsRunning {
        // it should revert with ZeroJobNonce (R2 PM8: no V3 test had it)
        IPayments.PaymentItem memory item = _item(users.alice, address(usdc), AMOUNT, bytes32(0));
        vm.prank(users.amira);
        vm.expectRevert(IPayments.ZeroJobNonce.selector);
        payments.send(item);
    }

    modifier whenEveryFieldIsSet() {
        _;
    }

    function test_WhenTheSuppliedPaymentIdIsNotPaymentIdOfTheItem() external whenNoCallIsRunning whenEveryFieldIsSet {
        // it should revert with PaymentIdMismatch: a copied id cannot change the amount or the recipient
        IPayments.PaymentItem memory item = _item(users.alice, address(usdc), AMOUNT);

        IPayments.PaymentItem memory attack = _item(users.alice, address(usdc), 1);
        attack.paymentId = item.paymentId;
        vm.prank(users.eve);
        vm.expectRevert(abi.encodeWithSelector(IPayments.PaymentIdMismatch.selector, _id(attack), item.paymentId));
        payments.send(attack);

        attack = _item(users.eve, address(usdc), AMOUNT);
        attack.paymentId = item.paymentId;
        vm.prank(users.eve);
        vm.expectRevert(abi.encodeWithSelector(IPayments.PaymentIdMismatch.selector, _id(attack), item.paymentId));
        payments.send(attack);

        // The genuine item still pays.
        vm.prank(users.amira);
        payments.send(item);
        assertTrue(payments.paid(item.paymentId), "genuine item paid");
    }

    function test_WhenTheItemNamesAnExecutorAndTheCallerIsSomeoneElse()
        external
        whenNoCallIsRunning
        whenEveryFieldIsSet
    {
        IPayments.PaymentItem memory item = _item(users.alice, address(usdc), AMOUNT);
        item.executor = users.jordan;
        item.paymentId = _id(item);

        // it should revert with InvalidExecutor
        vm.prank(users.eve);
        vm.expectRevert(abi.encodeWithSelector(IPayments.InvalidExecutor.selector, users.jordan, users.eve));
        payments.send(item);

        // The named executor may send it.
        vm.prank(users.jordan);
        payments.send(item);
        assertTrue(payments.paid(item.paymentId), "executor's send paid");

        // The spec's order puts the executor check before the paid check: Eve's replay of the paid
        // item is refused as the wrong executor, not as consumed.
        vm.prank(users.eve);
        vm.expectRevert(abi.encodeWithSelector(IPayments.InvalidExecutor.selector, users.jordan, users.eve));
        payments.send(item);
    }

    function test_WhenThisPaymentIdWasAlreadyPaid() external whenNoCallIsRunning whenEveryFieldIsSet {
        IPayments.PaymentItem memory item = _item(users.alice, address(usdc), AMOUNT);
        vm.prank(users.amira);
        payments.send(item);

        // it should revert with PaymentIdConsumed
        vm.prank(users.amira);
        vm.expectRevert(abi.encodeWithSelector(IPayments.PaymentIdConsumed.selector, item.paymentId));
        payments.send(item);
        assertEq(usdc.balanceOf(users.alice), 1_000_000 * USDC_UNIT + AMOUNT, "paid once");
    }

    function test_WhenTheTokenHasNoCode() external whenNoCallIsRunning whenEveryFieldIsSet {
        // it should revert with TokenHasNoCode
        address codeless = makeAddr("codeless token");
        IPayments.PaymentItem memory item = _item(users.alice, codeless, AMOUNT);
        vm.prank(users.amira);
        vm.expectRevert(abi.encodeWithSelector(IPayments.TokenHasNoCode.selector, codeless));
        payments.send(item);
        assertFalse(payments.paid(item.paymentId), "id unpaid");
    }

    modifier whenThePaymentIsNewAndTheTokenIsAContract() {
        _;
    }

    function test_WhenTheTokensTransferFromReverts()
        external
        whenNoCallIsRunning
        whenEveryFieldIsSet
        whenThePaymentIsNewAndTheTokenIsAContract
    {
        // it should bubble up the token's revert data unchanged
        // OpenZeppelin ERC20: allowance too low.
        vm.prank(users.amira);
        usdc.approve(address(payments), AMOUNT - 1);
        IPayments.PaymentItem memory item = _item(users.alice, address(usdc), AMOUNT);
        vm.prank(users.amira);
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientAllowance.selector, address(payments), AMOUNT - 1, AMOUNT
            )
        );
        payments.send(item);

        // A no-return token with its own error data (beta V2 Payments.t.sol:197-221).
        vm.prank(users.amira);
        usdt.approve(address(payments), 0);
        item = _item(users.alice, address(usdt), AMOUNT);
        vm.prank(users.amira);
        vm.expectRevert(
            abi.encodeWithSelector(
                MockNoReturnToken.InsufficientAllowance.selector, users.amira, address(payments), 0, AMOUNT
            )
        );
        payments.send(item);
    }

    function test_WhenTheTokensTransferFromReturnsFalse()
        external
        whenNoCallIsRunning
        whenEveryFieldIsSet
        whenThePaymentIsNewAndTheTokenIsAContract
    {
        // it should revert with TokenCallReturnedFalse
        IPayments.PaymentItem memory item = _item(users.alice, address(falseToken), AMOUNT);
        vm.prank(users.amira);
        vm.expectRevert(abi.encodeWithSelector(IPayments.TokenCallReturnedFalse.selector, address(falseToken)));
        payments.send(item);
    }

    function test_WhenTheTokensTransferFromReturnsNothing()
        external
        whenNoCallIsRunning
        whenEveryFieldIsSet
        whenThePaymentIsNewAndTheTokenIsAContract
    {
        // it should accept it and still check the exact balance (R2 PM7, on Payments itself)
        IPayments.PaymentItem memory item = _item(users.alice, address(usdt), AMOUNT);
        uint256 aliceBefore = usdt.balanceOf(users.alice);
        uint256 amiraBefore = usdt.balanceOf(users.amira);
        vm.prank(users.amira);
        payments.send(item);
        assertEq(usdt.balanceOf(users.alice), aliceBefore + AMOUNT, "recipient got exactly the amount");
        assertEq(usdt.balanceOf(users.amira), amiraBefore - AMOUNT, "payer paid exactly the amount");
        assertTrue(payments.paid(item.paymentId), "id paid");
    }

    function test_WhenTheTokenRe_entersSendOrSendBatchDuringTransferFrom()
        external
        whenNoCallIsRunning
        whenEveryFieldIsSet
        whenThePaymentIsNewAndTheTokenIsAContract
    {
        // it should revert the inner call with ReentrantCall (R2 PM9), for a re-entered sendBatch too
        IPayments.PaymentItem memory inner = _item(users.bob, address(usdc), AMOUNT, keccak256("inner"));
        reentrantToken.arm(address(payments), abi.encodeCall(IPayments.sendBatch, (_one(inner))));
        IPayments.PaymentItem memory outer = _item(users.alice, address(reentrantToken), AMOUNT);
        uint256 aliceBefore = reentrantToken.balanceOf(users.alice);

        vm.prank(users.amira);
        payments.send(outer);

        assertTrue(reentrantToken.reentered(), "the token re-entered");
        assertFalse(reentrantToken.reentrySucceeded(), "inner sendBatch refused");
        assertEq(reentrantToken.reentryResult(), abi.encodeWithSelector(IPayments.ReentrantCall.selector));
        assertFalse(payments.paid(inner.paymentId), "inner id unpaid");
        assertEq(reentrantToken.balanceOf(users.alice), aliceBefore + AMOUNT, "outer paid exactly");
    }

    function test_WhenTheRecipientReceivesADifferentAmount()
        external
        whenNoCallIsRunning
        whenEveryFieldIsSet
        whenThePaymentIsNewAndTheTokenIsAContract
    {
        // it should revert with InexactTransfer: a fee-on-transfer token (1%)
        IPayments.PaymentItem memory item = _item(users.alice, address(feeToken), AMOUNT);
        vm.prank(users.amira);
        vm.expectRevert(
            abi.encodeWithSelector(IPayments.InexactTransfer.selector, address(feeToken), AMOUNT, AMOUNT - AMOUNT / 100)
        );
        payments.send(item);

        // and a rebasing token whose shares round the amount down
        item = _item(users.alice, address(rebasingToken), AMOUNT);
        uint256 received = _rebasingReceived(users.alice, AMOUNT);
        assertLt(received, AMOUNT, "fixture: the rebasing transfer arrives short");
        vm.prank(users.amira);
        vm.expectRevert(
            abi.encodeWithSelector(IPayments.InexactTransfer.selector, address(rebasingToken), AMOUNT, received)
        );
        payments.send(item);
    }

    function test_GivenTheRecipientIsTheCaller()
        external
        whenNoCallIsRunning
        whenEveryFieldIsSet
        whenThePaymentIsNewAndTheTokenIsAContract
    {
        // it should require the balance not to change: a standard token's self-send pays and moves nothing
        IPayments.PaymentItem memory item = _item(users.amira, address(usdc), AMOUNT);
        uint256 before = usdc.balanceOf(users.amira);
        vm.prank(users.amira);
        payments.send(item);
        assertEq(usdc.balanceOf(users.amira), before, "self-send leaves the balance unchanged");
        assertTrue(payments.paid(item.paymentId), "self-send id paid");

        // a fee token burns from a self-send, so the balance falls and the send reverts with expected 0
        item = _item(users.amira, address(feeToken), AMOUNT);
        vm.prank(users.amira);
        vm.expectRevert(abi.encodeWithSelector(IPayments.InexactTransfer.selector, address(feeToken), 0, 0));
        payments.send(item);
        assertFalse(payments.paid(item.paymentId), "refused self-send unpaid");
    }

    function test_GivenThePaymentRevertsForAnyReason()
        external
        whenNoCallIsRunning
        whenEveryFieldIsSet
        whenThePaymentIsNewAndTheTokenIsAContract
    {
        // it should leave the payment id unpaid (R2 PM5)
        IPayments.PaymentItem memory refused = _item(users.alice, address(falseToken), AMOUNT);
        vm.prank(users.amira);
        vm.expectRevert(abi.encodeWithSelector(IPayments.TokenCallReturnedFalse.selector, address(falseToken)));
        payments.send(refused);
        assertFalse(payments.paid(refused.paymentId), "false-returning id unpaid");

        IPayments.PaymentItem memory short = _item(users.alice, address(feeToken), AMOUNT);
        vm.prank(users.amira);
        vm.expectRevert(
            abi.encodeWithSelector(IPayments.InexactTransfer.selector, address(feeToken), AMOUNT, AMOUNT - AMOUNT / 100)
        );
        payments.send(short);
        assertFalse(payments.paid(short.paymentId), "short-transfer id unpaid");

        // The refused id can still be paid once the token is exact.
        feeToken.setFeeBps(0);
        vm.prank(users.amira);
        payments.send(short);
        assertTrue(payments.paid(short.paymentId), "id paid after the fee is removed");
    }

    function test_WhenTheRecipientReceivesExactlyTheAmount()
        external
        whenNoCallIsRunning
        whenEveryFieldIsSet
        whenThePaymentIsNewAndTheTokenIsAContract
    {
        // Someone donates to Payments first: its own balance must stay at exactly that.
        vm.prank(users.ben);
        usdc.transfer(address(payments), 7 * USDC_UNIT);
        IPayments.PaymentItem memory item = _item(users.alice, address(usdc), AMOUNT);
        uint256 aliceBefore = usdc.balanceOf(users.alice);
        uint256 safeBefore = usdc.balanceOf(address(safe));

        // it should emit PaymentSent
        vm.expectEmit(address(payments));
        emit IPayments.PaymentSent(
            item.paymentId, address(safe), users.alice, address(usdc), AMOUNT, KIND_INVOICE, DOCUMENT_HASH
        );
        vm.prank(address(safe));
        payments.send(item);

        // it should mark the payment id as paid
        assertTrue(payments.paid(item.paymentId), "id paid");
        // it should leave Payments' own balance unchanged
        assertEq(usdc.balanceOf(address(payments)), 7 * USDC_UNIT, "Payments' own balance unchanged");
        assertEq(usdc.balanceOf(users.alice), aliceBefore + AMOUNT, "recipient got exactly the amount");
        assertEq(usdc.balanceOf(address(safe)), safeBefore - AMOUNT, "the caller paid exactly the amount");
    }
}
