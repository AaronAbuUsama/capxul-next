// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IEscrow } from "../../../../../src/interfaces/IEscrow.sol";
import { IPayments } from "../../../../../src/interfaces/IPayments.sol";

import { Escrow_Test } from "../../../../utils/Escrow/Escrow_Test.sol";

contract Payout_Escrow_Unit_Concrete_Test is Escrow_Test {
    function test_WhenTheTokenIsAPrecompileWithoutCode() external {
        // it should reject a token without code
        IEscrow.Terms memory terms = _terms(users.bob, INVOICE);
        terms.token = address(4); // identity precompile echoes balanceOf calldata
        IEscrow escrow = _escrow(terms);
        vm.expectRevert(abi.encodeWithSelector(IEscrow.TokenHasNoCode.selector, address(4)));
        escrow.payout();
        assertEq(_state(escrow), uint256(IEscrow.State.Open), "still open");
    }

    function test_WhenACallIsAlreadyRunning() external {
        IEscrow.Terms memory terms = _terms(users.bob, INVOICE);
        terms.token = address(reentrantToken);
        IEscrow escrow = _escrow(terms);
        reentrantToken.mint(address(escrow), AMOUNT);
        reentrantToken.arm(address(escrow), abi.encodeCall(IEscrow.payout, ()));
        uint256 payeeBefore = reentrantToken.balanceOf(users.bob);

        escrow.payout();

        // it should revert with ReentrantCall
        assertTrue(reentrantToken.reentered(), "the token re-entered");
        assertFalse(reentrantToken.reentrySucceeded(), "the inner payout failed");
        assertEq(reentrantToken.reentryResult(), abi.encodeWithSelector(IEscrow.ReentrantCall.selector));
        assertEq(reentrantToken.balanceOf(users.bob) - payeeBefore, AMOUNT, "the outer payout still paid");
    }

    function test_WhenTheConditionIsNotInvoiceAmountReached() external {
        IEscrow escrow = _claimEscrow(claimedPayee);
        usdc.mint(address(escrow), AMOUNT);
        // it should revert with InvalidCondition
        vm.expectRevert(abi.encodeWithSelector(IEscrow.InvalidCondition.selector, CLAIM));
        escrow.payout();
    }

    function test_WhenTheEscrowIsNotOpen() external {
        IEscrow escrow = _invoiceEscrow();
        usdc.mint(address(escrow), AMOUNT - 1);
        vm.prank(owner);
        escrow.refund();
        usdc.mint(address(escrow), AMOUNT);
        // it should revert with JobNotOpen
        vm.expectRevert(IEscrow.JobNotOpen.selector);
        escrow.payout();

        IEscrow paidEscrow = _escrow(_terms(users.alice, INVOICE));
        usdc.mint(address(paidEscrow), AMOUNT);
        paidEscrow.payout();
        usdc.mint(address(paidEscrow), AMOUNT);
        vm.expectRevert(IEscrow.JobNotOpen.selector);
        paidEscrow.payout();
    }

    function test_GivenThePaymentIdWasAlreadyPaidThroughPaymentsBySomeoneElse() external {
        IEscrow.Terms memory terms = _terms(users.bob, INVOICE);
        IEscrow escrow = _escrow(terms);
        usdc.mint(address(escrow), AMOUNT / 2);
        _payDirectly(terms, address(escrow));
        uint256 ownerBefore = usdc.balanceOf(owner);
        uint256 payeeBefore = usdc.balanceOf(users.bob);

        // it should emit InvoicePaymentCompleted with the surplus
        vm.expectEmit(true, true, true, true, address(escrow));
        emit IEscrow.InvoicePaymentCompleted(owner, users.bob, escrow.paymentId(), AMOUNT / 2);
        escrow.payout();

        // it should mark the escrow paid
        assertEq(_state(escrow), uint256(IEscrow.State.Paid), "state");
        // it should return any balance to the owner Safe
        assertEq(usdc.balanceOf(owner) - ownerBefore, AMOUNT / 2, "owner got the balance");
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow empty");
        assertEq(usdc.balanceOf(users.bob), payeeBefore, "payee not paid twice");
    }

    function test_WhenTheEscrowHoldsLessThanTheAmount() external {
        IEscrow escrow = _invoiceEscrow();
        usdc.mint(address(escrow), AMOUNT - 1);
        // it should revert with ConditionNotMet
        vm.expectRevert(IEscrow.ConditionNotMet.selector);
        escrow.payout();
    }

    function test_WhenTheEscrowHoldsAtLeastTheAmount() external {
        IEscrow.Terms memory terms = _terms(users.bob, INVOICE);
        terms.token = address(reentrantToken);
        IEscrow escrow = _escrow(terms);
        IPayments.PaymentItem memory item = _item(terms, address(escrow));
        reentrantToken.mint(address(escrow), AMOUNT + 7);
        // Reads the state from inside the token transfer that Payments makes.
        reentrantToken.arm(address(escrow), abi.encodeCall(IEscrow.state, ()));
        uint256 ownerBefore = reentrantToken.balanceOf(owner);
        uint256 payeeBefore = reentrantToken.balanceOf(users.bob);

        // it should approve Payments for the amount and send the fixed item
        vm.expectCall(address(reentrantToken), abi.encodeCall(IERC20.approve, (address(payments), AMOUNT)));
        vm.expectCall(address(payments), abi.encodeCall(IPayments.send, (item)));
        // it should emit EscrowPaid
        vm.expectEmit(true, true, true, true, address(escrow));
        emit IEscrow.EscrowPaid(owner, users.bob, item.paymentId, AMOUNT);
        vm.prank(users.eve); // anyone may pay out
        escrow.payout();

        // it should mark the escrow paid before paying
        assertTrue(reentrantToken.reentrySucceeded(), "state read during the transfer");
        assertEq(abi.decode(reentrantToken.reentryResult(), (uint256)), uint256(IEscrow.State.Paid), "paid first");
        assertEq(_state(escrow), uint256(IEscrow.State.Paid), "state");
        assertEq(reentrantToken.balanceOf(users.bob) - payeeBefore, AMOUNT, "payee got exactly the amount");
        // it should return any surplus to the owner Safe
        assertEq(reentrantToken.balanceOf(owner) - ownerBefore, 7, "owner got the surplus");
        assertEq(reentrantToken.balanceOf(address(escrow)), 0, "escrow empty");
        assertEq(reentrantToken.allowance(address(escrow), address(payments)), 0, "no standing approval");
        assertTrue(payments.paid(item.paymentId), "id consumed");
    }

    /// @dev Port of beta `CapxulEscrow.t.sol:342` (R2 ES14), beyond the tree: a token that returns false
    /// fails the payout whole, so the escrow stays open with its funds and the id stays unpaid.
    function test_WhenTheTokenReturnsFalse() external {
        IEscrow.Terms memory terms = _terms(users.bob, INVOICE);
        terms.token = address(falseToken);
        IEscrow escrow = _escrow(terms);
        falseToken.mint(address(escrow), AMOUNT);
        vm.expectRevert(abi.encodeWithSelector(IEscrow.TokenCallReturnedFalse.selector, address(falseToken)));
        escrow.payout();
        assertEq(_state(escrow), uint256(IEscrow.State.Open), "still open");
        assertEq(falseToken.balanceOf(address(escrow)), AMOUNT, "funds in place");
    }

    /// @dev Port of beta `CapxulEscrow.t.sol:317` (R2 ES13), beyond the tree: an item that copies the
    /// escrow's id with other terms is refused by Payments and does not block the escrow's payout.
    function test_WhenACopiedIdWithChangedTermsIsSentFirst() external {
        IEscrow.Terms memory terms = _terms(users.bob, INVOICE);
        IEscrow escrow = _escrow(terms);
        usdc.mint(address(escrow), AMOUNT);
        IPayments.PaymentItem memory attack = _item(terms, address(escrow));
        attack.amount = 1;
        attack.paymentId = escrow.paymentId();
        bytes32 expected = payments.paymentId(attack);
        vm.startPrank(users.eve);
        usdc.approve(address(payments), 1);
        vm.expectRevert(abi.encodeWithSelector(IPayments.PaymentIdMismatch.selector, expected, escrow.paymentId()));
        payments.send(attack);
        vm.stopPrank();
        escrow.payout();
        assertEq(_state(escrow), uint256(IEscrow.State.Paid), "paid");
    }
}
