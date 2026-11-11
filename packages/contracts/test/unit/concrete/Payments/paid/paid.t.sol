// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IPayments } from "../../../../../src/interfaces/IPayments.sol";
import { Payments_Test } from "../../../../utils/Payments/Payments_Test.sol";

contract Paid_Payments_Unit_Concrete_Test is Payments_Test {
    function test_WhenThePaymentIdWasPaidBySendOrSendBatch() external {
        IPayments.PaymentItem memory sent = _item(users.alice, address(usdc), AMOUNT, keccak256("by send"));
        IPayments.PaymentItem memory batched = _item(users.bob, address(usdc), AMOUNT, keccak256("by batch"));
        vm.startPrank(users.amira);
        payments.send(sent);
        payments.sendBatch(_one(batched));
        vm.stopPrank();

        // it should return true
        assertTrue(payments.paid(sent.paymentId), "paid by send");
        assertTrue(payments.paid(batched.paymentId), "paid by sendBatch");
    }

    function test_WhenItWasNeverPaidOrItsPaymentReverted() external {
        IPayments.PaymentItem memory refused = _item(users.alice, address(falseToken), AMOUNT);
        vm.prank(users.amira);
        vm.expectRevert(abi.encodeWithSelector(IPayments.TokenCallReturnedFalse.selector, address(falseToken)));
        payments.send(refused);

        // it should return false
        assertFalse(payments.paid(refused.paymentId), "reverted payment unpaid");
        assertFalse(payments.paid(_item(users.bob, address(usdc), AMOUNT).paymentId), "never sent");
        assertFalse(payments.paid(bytes32(0)), "the zero id");
    }
}
