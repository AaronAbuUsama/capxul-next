// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IPayments } from "../../../../src/interfaces/IPayments.sol";
import { Payments_Test } from "../../../utils/Payments/Payments_Test.sol";

contract PaymentId_Payments_Unit_Fuzz_Test is Payments_Test {
    /// @dev P4: for any terms, the id is the spec's hash and ignores the item's own id field.
    function testFuzz_paymentId_isTheSpecHash(IPayments.PaymentItem memory item, bytes32 otherIdField) external view {
        bytes32 expected = _id(item);
        assertEq(payments.paymentId(item), expected, "spec hash");
        item.paymentId = otherIdField;
        assertEq(payments.paymentId(item), expected, "own id field ignored");
    }

    /// @dev P4: changing any one hashed field to a different value changes the id.
    function testFuzz_paymentId_eachFieldBinds(
        IPayments.PaymentItem memory item,
        uint8 rawField,
        bytes32 value
    )
        external
        view
    {
        bytes32 id = payments.paymentId(item);
        IPayments.PaymentItem memory changed = item;
        uint256 field = bound(rawField, 0, 6);
        if (field == 0) {
            vm.assume(value != item.jobNonce);
            changed.jobNonce = value;
        } else if (field == 1) {
            vm.assume(address(bytes20(value)) != item.executor);
            changed.executor = address(bytes20(value));
        } else if (field == 2) {
            vm.assume(address(bytes20(value)) != item.recipient);
            changed.recipient = address(bytes20(value));
        } else if (field == 3) {
            vm.assume(address(bytes20(value)) != item.token);
            changed.token = address(bytes20(value));
        } else if (field == 4) {
            vm.assume(uint256(value) != item.amount);
            changed.amount = uint256(value);
        } else if (field == 5) {
            vm.assume(uint16(uint256(value)) != item.kind);
            changed.kind = uint16(uint256(value));
        } else {
            vm.assume(value != item.documentHash);
            changed.documentHash = value;
        }
        assertNotEq(payments.paymentId(changed), id, "a changed field changes the id");
    }
}
