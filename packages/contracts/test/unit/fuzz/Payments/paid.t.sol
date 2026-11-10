// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IPayments } from "../../../../src/interfaces/IPayments.sol";
import { Payments_Test } from "../../../utils/Payments/Payments_Test.sol";

contract Paid_Payments_Unit_Fuzz_Test is Payments_Test {
    /// @dev P3: only the id that was paid reads true; any other id reads false.
    function testFuzz_paid_onlyThePaidId(bytes32 other, uint256 amount) external {
        amount = bound(amount, 1, 1_000_000 * USDC_UNIT);
        IPayments.PaymentItem memory item = _item(users.alice, address(usdc), amount);
        vm.assume(other != item.paymentId);
        assertFalse(payments.paid(item.paymentId), "unpaid before");

        vm.prank(users.amira);
        payments.send(item);

        assertTrue(payments.paid(item.paymentId), "paid after");
        assertFalse(payments.paid(other), "any other id unpaid");
    }
}
