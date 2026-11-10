// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IPayments } from "../../src/interfaces/IPayments.sol";
import { Payments } from "../../src/money/Payments.sol";
import { Addresses } from "./Addresses.sol";
import { Fork_Test } from "./Fork_Test.t.sol";

/// @notice W1's proof (slices/W1.md): the company Safe 1.4.1, behind Hats Signer Gate v2, pays a batch of
/// three items through `Payments.sendBatch` in one Board transaction (D1: Amira approves the hash from her
/// own Safe, then anyone executes), and each `PaymentSent` is emitted in order with the Safe as sender.
contract Payments_Fork_Test is Fork_Test {
    bytes32 internal constant PAYMENT_TYPEHASH = keccak256(
        "CapxulPayment(uint256 chainId,address router,bytes32 jobNonce,address executor,address recipient,address token,uint256 amount,uint16 kind,bytes32 documentHash)"
    );

    address internal constant MULTI_SEND_CALL_ONLY = Addresses.MULTI_SEND_CALL_ONLY_141;

    Payments internal payments;

    function _deployProtocol() internal virtual override {
        payments = new Payments();
        vm.label(address(payments), "Payments");
    }

    function test_BoardPaysABatchOfThreeFromTheSafe() external {
        IPayments.PaymentItem[] memory items = new IPayments.PaymentItem[](3);
        items[0] = _item(users.alice, 4000 * USDC_UNIT, 2, "payroll alice 2026-01");
        items[1] = _item(users.bob, 3500 * USDC_UNIT, 2, "payroll bob 2026-01");
        items[2] = _item(users.jordan, 120 * USDC_UNIT, 3, "reimbursement jordan 0001");
        uint256 total = 7620 * USDC_UNIT;
        uint256 safeBefore = usdc.balanceOf(address(companySafe));

        Call[] memory calls = new Call[](2);
        calls[0] = Call(address(usdc), 0, abi.encodeCall(IERC20.approve, (address(payments), total)));
        calls[1] = Call(address(payments), 0, abi.encodeCall(IPayments.sendBatch, (items)));

        // The Board approves first: expectEmit binds to the next call, which must be the Safe executing the batch.
        bytes memory batch = _multiSend(calls);
        bytes memory sig = _boardApprove(MULTI_SEND_CALL_ONLY, 0, batch, DELEGATECALL);
        for (uint256 i; i < items.length; ++i) {
            vm.expectEmit(address(payments));
            emit IPayments.PaymentSent(
                items[i].paymentId,
                address(companySafe),
                items[i].recipient,
                address(usdc),
                items[i].amount,
                items[i].kind,
                items[i].documentHash
            );
        }
        _execCompany(MULTI_SEND_CALL_ONLY, 0, batch, DELEGATECALL, sig);

        _assertGateIsOnlyModuleAndGuard();
        assertEq(usdc.balanceOf(address(companySafe)), safeBefore - total, "the Safe paid the total");
        assertEq(usdc.balanceOf(users.alice), 1_000_000 * USDC_UNIT + 4000 * USDC_UNIT, "alice");
        assertEq(usdc.balanceOf(users.bob), 1_000_000 * USDC_UNIT + 3500 * USDC_UNIT, "bob");
        assertEq(usdc.balanceOf(users.jordan), 1_000_000 * USDC_UNIT + 120 * USDC_UNIT, "jordan");
        assertEq(usdc.balanceOf(address(payments)), 0, "Payments holds nothing");
        assertEq(usdc.allowance(address(companySafe), address(payments)), 0, "the approval is used up");
        for (uint256 i; i < items.length; ++i) {
            assertTrue(payments.paid(items[i].paymentId), "paid");
        }
    }

    function _item(
        address recipient,
        uint256 amount,
        uint16 kind,
        string memory document
    )
        internal
        view
        returns (IPayments.PaymentItem memory item)
    {
        item = IPayments.PaymentItem({
            paymentId: bytes32(0),
            recipient: recipient,
            token: address(usdc),
            amount: amount,
            kind: kind,
            documentHash: keccak256(bytes(document)),
            jobNonce: keccak256(abi.encode("fork job", document)),
            executor: address(0)
        });
        item.paymentId = keccak256(
            abi.encode(
                PAYMENT_TYPEHASH,
                block.chainid,
                address(payments),
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
}
