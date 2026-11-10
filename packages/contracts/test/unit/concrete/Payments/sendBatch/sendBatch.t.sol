// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Vm } from "forge-std/Vm.sol";

import { IPayments } from "../../../../../src/interfaces/IPayments.sol";
import { Payments_Test } from "../../../../utils/Payments/Payments_Test.sol";

/// @dev Ports beta `packages/contracts/test/unit/CapxulPaymentsV3.t.sol:105-114` (repeated id in one
/// batch) and V2 `packages/contracts/test/unit/Payments.t.sol:84-99` (atomic batch) (research R2 PM6).
contract SendBatch_Payments_Unit_Concrete_Test is Payments_Test {
    function test_WhenACallIntoPaymentsIsAlreadyRunning() external {
        // A token re-enters sendBatch from inside the outer batch's first transfer.
        IPayments.PaymentItem memory inner = _item(users.bob, address(usdc), AMOUNT, keccak256("inner"));
        reentrantToken.arm(address(payments), abi.encodeCall(IPayments.sendBatch, (_one(inner))));
        IPayments.PaymentItem[] memory outer = new IPayments.PaymentItem[](2);
        outer[0] = _item(users.alice, address(reentrantToken), AMOUNT, keccak256("outer 0"));
        outer[1] = _item(users.bob, address(usdc), AMOUNT, keccak256("outer 1"));

        vm.prank(users.amira);
        payments.sendBatch(outer);

        // it should revert with ReentrantCall
        assertTrue(reentrantToken.reentered(), "the token re-entered");
        assertFalse(reentrantToken.reentrySucceeded(), "inner sendBatch refused");
        assertEq(reentrantToken.reentryResult(), abi.encodeWithSelector(IPayments.ReentrantCall.selector));
        assertFalse(payments.paid(inner.paymentId), "inner id unpaid");
        assertTrue(payments.paid(outer[0].paymentId) && payments.paid(outer[1].paymentId), "outer items paid");
    }

    function test_WhenItemsIsEmpty() external {
        uint256 safeBefore = usdc.balanceOf(address(safe));
        vm.recordLogs();
        vm.prank(address(safe));
        payments.sendBatch(new IPayments.PaymentItem[](0));

        // it should do nothing and emit nothing
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 0, "no events");
        assertEq(usdc.balanceOf(address(safe)), safeBefore, "no money moved");
    }

    function test_WhenAnyItemWouldRevertUnderSend() external {
        IPayments.PaymentItem[] memory items = new IPayments.PaymentItem[](3);
        items[0] = _item(users.alice, address(usdc), AMOUNT, keccak256("salary alice"));
        items[1] = _item(users.bob, address(usdc), AMOUNT, keccak256("salary bob"));
        items[2] = _item(users.investor, address(feeToken), AMOUNT, keccak256("fee"));
        feeToken.mint(address(safe), AMOUNT);
        uint256 aliceBefore = usdc.balanceOf(users.alice);
        uint256 bobBefore = usdc.balanceOf(users.bob);

        // it should revert the whole batch with that item's error
        vm.prank(address(safe));
        vm.expectRevert(
            abi.encodeWithSelector(IPayments.InexactTransfer.selector, address(feeToken), AMOUNT, AMOUNT - AMOUNT / 100)
        );
        payments.sendBatch(items);

        assertFalse(payments.paid(items[0].paymentId), "first id unpaid");
        assertFalse(payments.paid(items[1].paymentId), "second id unpaid");
        assertEq(usdc.balanceOf(users.alice), aliceBefore, "first item undone");
        assertEq(usdc.balanceOf(users.bob), bobBefore, "second item undone");

        // A validation error in the middle names that item's error.
        items[2] = items[1];
        items[1] = _item(users.bob, address(usdc), 0, keccak256("zero"));
        vm.prank(address(safe));
        vm.expectRevert(IPayments.ZeroAmount.selector);
        payments.sendBatch(items);
        assertFalse(payments.paid(items[0].paymentId), "first id still unpaid");
    }

    function test_WhenTwoItemsHaveTheSamePaymentId() external {
        IPayments.PaymentItem[] memory items = new IPayments.PaymentItem[](2);
        items[0] = _item(users.alice, address(usdc), AMOUNT);
        items[1] = items[0];
        uint256 aliceBefore = usdc.balanceOf(users.alice);

        // it should revert with PaymentIdConsumed on the second
        vm.prank(address(safe));
        vm.expectRevert(abi.encodeWithSelector(IPayments.PaymentIdConsumed.selector, items[0].paymentId));
        payments.sendBatch(items);
        assertFalse(payments.paid(items[0].paymentId), "the first payment is undone too");
        assertEq(usdc.balanceOf(users.alice), aliceBefore, "nothing paid");
    }

    function test_WhenEveryItemIsValid() external {
        IPayments.PaymentItem[] memory items = new IPayments.PaymentItem[](3);
        items[0] = _item(users.alice, address(usdc), 1000 * USDC_UNIT, keccak256("payroll alice"));
        items[1] = _item(users.bob, address(usdt), 2000 * USDC_UNIT, keccak256("payroll bob"));
        items[2] = _item(users.alice, address(dai), 3 ether, keccak256("reimbursement alice"));
        items[2].kind = 3;
        items[2].executor = address(safe);
        items[2].paymentId = _id(items[2]);
        usdt.mint(address(safe), 2000 * USDC_UNIT);
        dai.mint(address(safe), 3 ether);
        uint256 aliceUsdc = usdc.balanceOf(users.alice);
        uint256 bobUsdt = usdt.balanceOf(users.bob);
        uint256 aliceDai = dai.balanceOf(users.alice);

        // it should emit one PaymentSent per item in order
        for (uint256 i; i < items.length; ++i) {
            vm.expectEmit(address(payments));
            emit IPayments.PaymentSent(
                items[i].paymentId,
                address(safe),
                items[i].recipient,
                items[i].token,
                items[i].amount,
                items[i].kind,
                items[i].documentHash
            );
        }
        vm.prank(address(safe));
        payments.sendBatch(items);

        // it should pay each item in order
        assertEq(usdc.balanceOf(users.alice), aliceUsdc + 1000 * USDC_UNIT, "item 0 paid");
        assertEq(usdt.balanceOf(users.bob), bobUsdt + 2000 * USDC_UNIT, "item 1 paid");
        assertEq(dai.balanceOf(users.alice), aliceDai + 3 ether, "item 2 paid");
        for (uint256 i; i < items.length; ++i) {
            assertTrue(payments.paid(items[i].paymentId), "every id paid");
        }
    }
}
