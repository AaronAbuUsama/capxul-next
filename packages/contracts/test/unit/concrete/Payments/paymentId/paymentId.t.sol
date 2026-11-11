// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IPayments } from "../../../../../src/interfaces/IPayments.sol";
import { Payments } from "../../../../../src/money/Payments.sol";
import { Payments_Test } from "../../../../utils/Payments/Payments_Test.sol";

/// @dev Ports beta `packages/contracts/test/unit/CapxulPaymentsV3.t.sol:46-73` (research R2 PM1); the
/// per-field leaf is also proved for every input by `check_P4_paymentIdInjective_*` (Halmos).
contract PaymentId_Payments_Unit_Concrete_Test is Payments_Test {
    function test_ShouldHashTheTypeHashAndChainIdAndThisContractAndJobNonceAndExecutorAndRecipientAndTokenAndAmountAndKindAndDocumentHash()
        external
        view
    {
        IPayments.PaymentItem memory item = _item(users.alice, address(usdc), AMOUNT);
        item.executor = users.jordan;
        item.kind = 2;
        // it should hash the type hash and chain id and this contract and job nonce and executor and recipient
        // and token and amount and kind and document hash
        bytes32 expected = keccak256(
            abi.encode(
                keccak256(
                    "CapxulPayment(uint256 chainId,address router,bytes32 jobNonce,address executor,address recipient,address token,uint256 amount,uint16 kind,bytes32 documentHash)"
                ),
                block.chainid,
                address(payments),
                JOB_NONCE,
                users.jordan,
                users.alice,
                address(usdc),
                AMOUNT,
                uint16(2),
                DOCUMENT_HASH
            )
        );
        assertEq(payments.paymentId(item), expected);
    }

    function test_ShouldIgnoreTheItemsOwnPaymentIdField() external view {
        IPayments.PaymentItem memory item = _item(users.alice, address(usdc), AMOUNT);
        bytes32 id = payments.paymentId(item);
        // it should ignore the item's own paymentId field
        item.paymentId = bytes32(0);
        assertEq(payments.paymentId(item), id, "zero id field");
        item.paymentId = keccak256("anything");
        assertEq(payments.paymentId(item), id, "arbitrary id field");
        assertEq(id, _id(item), "the spec's id");
    }

    function test_WhenAnyOneOfTheHashedFieldsChanges() external view {
        IPayments.PaymentItem memory base = _item(users.alice, address(usdc), AMOUNT);
        bytes32 id = payments.paymentId(base);
        assertEq(id, _id(base), "base id is the spec's");

        // it should return a different id, for each of the seven item fields
        for (uint256 field; field < 7; ++field) {
            IPayments.PaymentItem memory changed = _item(users.alice, address(usdc), AMOUNT);
            if (field == 0) changed.jobNonce = keccak256("job 2");
            if (field == 1) changed.executor = users.jordan;
            if (field == 2) changed.recipient = users.bob;
            if (field == 3) changed.token = address(dai);
            if (field == 4) changed.amount = AMOUNT + 1;
            if (field == 5) changed.kind = KIND_INVOICE + 1;
            if (field == 6) changed.documentHash = keccak256("invoice 2026-002");
            bytes32 changedId = payments.paymentId(changed);
            assertNotEq(changedId, id, "a changed field changes the id");
            assertEq(changedId, _id(changed), "the changed id is the spec's");
        }
    }

    function test_WhenTheSameItemIsHashedOnAnotherChainOrByAnotherPaymentsContract() external {
        IPayments.PaymentItem memory item = _item(users.alice, address(usdc), AMOUNT);
        bytes32 here = payments.paymentId(item);

        // it should return a different id: another Payments contract
        Payments other = new Payments();
        bytes32 there = other.paymentId(item);
        assertNotEq(there, here, "another router");
        assertEq(there, _idAt(item, block.chainid, address(other)), "the spec's id for the other router");

        // it should return a different id: another chain
        uint256 otherChainId = 8453; // Base mainnet, not the test chain
        vm.chainId(otherChainId);
        bytes32 otherChain = payments.paymentId(item);
        assertNotEq(otherChain, here, "another chain");
        assertEq(otherChain, _idAt(item, otherChainId, address(payments)), "the spec's id for the other chain");
    }
}
