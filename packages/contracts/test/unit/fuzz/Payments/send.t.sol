// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IPayments } from "../../../../src/interfaces/IPayments.sol";
import { Payments_Test } from "../../../utils/Payments/Payments_Test.sol";

/// @dev spec/payments.md "Fuzz": send with random amounts, a fee token, a rebasing token, a
/// false-returning token and a no-return token; plus the random-caller and random-field leaves of send.tree.
contract Send_Payments_Unit_Fuzz_Test is Payments_Test {
    uint256 internal constant BALANCE = 1_000_000 * USDC_UNIT;

    /// @dev P1: any amount up to the payer's balance arrives exactly, for any kind, nonce and document.
    function testFuzz_send_movesExactlyTheAmount(
        uint256 amount,
        uint16 kind,
        bytes32 jobNonce,
        bytes32 documentHash,
        bool noReturnToken
    )
        external
    {
        amount = bound(amount, 1, BALANCE);
        vm.assume(jobNonce != bytes32(0) && documentHash != bytes32(0));
        address token = noReturnToken ? address(usdt) : address(usdc);
        IPayments.PaymentItem memory item = _item(users.alice, token, amount, jobNonce);
        item.kind = kind;
        item.documentHash = documentHash;
        item.paymentId = _id(item);
        uint256 aliceBefore = _balance(token, users.alice);
        uint256 amiraBefore = _balance(token, users.amira);

        vm.expectEmit(address(payments));
        emit IPayments.PaymentSent(item.paymentId, users.amira, users.alice, token, amount, kind, documentHash);
        vm.prank(users.amira);
        payments.send(item);

        assertEq(_balance(token, users.alice), aliceBefore + amount, "recipient +amount");
        assertEq(_balance(token, users.amira), amiraBefore - amount, "payer -amount");
        assertEq(_balance(token, address(payments)), 0, "Payments holds nothing");
        assertTrue(payments.paid(item.paymentId), "paid");
    }

    /// @dev A fee-on-transfer token with any nonzero fee that takes at least one unit reverts and pays nothing.
    function testFuzz_send_feeTokenReverts(uint256 amount, uint256 feeBps) external {
        feeBps = bound(feeBps, 1, 10_000);
        amount = bound(amount, 1, BALANCE);
        uint256 fee = amount * feeBps / 10_000;
        vm.assume(fee > 0);
        feeToken.setFeeBps(feeBps);
        IPayments.PaymentItem memory item = _item(users.alice, address(feeToken), amount);

        vm.prank(users.amira);
        vm.expectRevert(
            abi.encodeWithSelector(IPayments.InexactTransfer.selector, address(feeToken), amount, amount - fee)
        );
        payments.send(item);
        assertFalse(payments.paid(item.paymentId), "unpaid");
    }

    /// @dev A rebasing token pays when its share maths delivers the exact amount and reverts otherwise.
    function testFuzz_send_rebasingTokenExactOrReverts(uint256 amount, uint256 index) external {
        index = bound(index, 0.5e18, 2e18);
        rebasingToken.rebase(index);
        amount = bound(amount, 1, rebasingToken.balanceOf(users.amira));
        IPayments.PaymentItem memory item = _item(users.alice, address(rebasingToken), amount);
        uint256 aliceBefore = rebasingToken.balanceOf(users.alice);
        uint256 received = _rebasingReceived(users.alice, amount);

        if (received != amount) {
            vm.expectRevert(
                abi.encodeWithSelector(IPayments.InexactTransfer.selector, address(rebasingToken), amount, received)
            );
        }
        vm.prank(users.amira);
        payments.send(item);

        assertEq(payments.paid(item.paymentId), received == amount, "paid only when exact");
        assertEq(rebasingToken.balanceOf(users.alice), aliceBefore + (received == amount ? amount : 0), "balance");
    }

    /// @dev A false-returning token always reverts TokenCallReturnedFalse.
    function testFuzz_send_falseTokenReverts(uint256 amount) external {
        amount = bound(amount, 1, type(uint256).max);
        IPayments.PaymentItem memory item = _item(users.alice, address(falseToken), amount);
        vm.prank(users.amira);
        vm.expectRevert(abi.encodeWithSelector(IPayments.TokenCallReturnedFalse.selector, address(falseToken)));
        payments.send(item);
        assertFalse(payments.paid(item.paymentId), "unpaid");
    }

    /// @dev P5: any caller other than a nonzero executor is refused; the executor is accepted.
    function testFuzz_send_onlyTheExecutor(address executor, address caller) external {
        vm.assume(executor != address(0) && caller != executor);
        IPayments.PaymentItem memory item = _item(users.alice, address(usdc), AMOUNT);
        item.executor = executor;
        item.paymentId = _id(item);

        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(IPayments.InvalidExecutor.selector, executor, caller));
        payments.send(item);

        vm.assume(executor != address(payments) && executor.code.length == 0);
        usdc.mint(executor, AMOUNT);
        vm.startPrank(executor);
        usdc.approve(address(payments), AMOUNT);
        payments.send(item);
        vm.stopPrank();
        assertTrue(payments.paid(item.paymentId), "the executor's send paid");
    }

    /// @dev P4: any supplied id other than the item's own is refused with both ids named.
    function testFuzz_send_idMismatch(bytes32 supplied) external {
        IPayments.PaymentItem memory item = _item(users.alice, address(usdc), AMOUNT);
        vm.assume(supplied != bytes32(0) && supplied != item.paymentId);
        bytes32 expected = item.paymentId;
        item.paymentId = supplied;
        vm.prank(users.amira);
        vm.expectRevert(abi.encodeWithSelector(IPayments.PaymentIdMismatch.selector, expected, supplied));
        payments.send(item);
    }

    /// @dev Self-send of any amount with a standard token pays and leaves the balance unchanged.
    function testFuzz_send_selfSendLeavesBalance(uint256 amount) external {
        amount = bound(amount, 1, BALANCE);
        IPayments.PaymentItem memory item = _item(users.amira, address(usdc), amount);
        uint256 before = usdc.balanceOf(users.amira);
        vm.prank(users.amira);
        payments.send(item);
        assertEq(usdc.balanceOf(users.amira), before, "unchanged");
        assertTrue(payments.paid(item.paymentId), "paid");
    }

    function _balance(address token, address account) internal view returns (uint256) {
        (, bytes memory data) = token.staticcall(abi.encodeWithSignature("balanceOf(address)", account));
        return abi.decode(data, (uint256));
    }
}
