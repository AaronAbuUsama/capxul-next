// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Vm } from "forge-std/Vm.sol";

import { IPayments } from "../../../../src/interfaces/IPayments.sol";
import { Payments_Test } from "../../../utils/Payments/Payments_Test.sol";

/// @dev Ports beta V2 `packages/contracts/test/unit/Payments.t.sol:128-162`
/// (`testFuzz_sendBatch_emitsOneOrderedEventPerItem`) onto Payments.
contract SendBatch_Payments_Unit_Fuzz_Test is Payments_Test {
    bytes32 internal constant PAYMENT_SENT =
        keccak256("PaymentSent(bytes32,address,address,address,uint256,uint16,bytes32)");

    /// @dev Any batch of 0 to 16 valid items pays each one and emits one event per item, in order.
    function testFuzz_sendBatch_paysEveryItemInOrder(uint8 rawLength, uint256 seed) external {
        uint256 length = bound(rawLength, 0, 16);
        IPayments.PaymentItem[] memory items = new IPayments.PaymentItem[](length);
        uint256 total;
        for (uint256 i; i < length; ++i) {
            uint256 amount = bound(uint256(keccak256(abi.encode(seed, i))), 1, 1000 * USDC_UNIT);
            items[i] =
                _item(i % 2 == 0 ? users.alice : users.bob, address(usdc), amount, keccak256(abi.encode("job", i)));
            total += amount;
        }
        uint256 safeBefore = usdc.balanceOf(address(safe));

        vm.recordLogs();
        vm.prank(address(safe));
        payments.sendBatch(items);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 seen;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(payments)) continue;
            assertEq(logs[i].topics[0], PAYMENT_SENT, "only PaymentSent");
            assertEq(logs[i].topics[1], items[seen].paymentId, "in order");
            assertEq(address(uint160(uint256(logs[i].topics[3]))), items[seen].recipient, "recipient");
            ++seen;
        }
        assertEq(seen, length, "one event per item");
        assertEq(usdc.balanceOf(address(safe)), safeBefore - total, "the Safe paid the total");
        for (uint256 i; i < length; ++i) {
            assertTrue(payments.paid(items[i].paymentId), "paid");
        }
    }

    /// @dev P6: a bad item at any position reverts the batch and consumes no id.
    function testFuzz_sendBatch_badItemAnywhereRevertsAll(uint8 rawLength, uint8 rawBad) external {
        uint256 length = bound(rawLength, 1, 8);
        uint256 bad = bound(rawBad, 0, length - 1);
        IPayments.PaymentItem[] memory items = new IPayments.PaymentItem[](length);
        for (uint256 i; i < length; ++i) {
            items[i] = _item(users.alice, address(usdc), AMOUNT, keccak256(abi.encode("job", i)));
        }
        items[bad] = _item(users.alice, address(falseToken), AMOUNT, keccak256("bad"));
        uint256 aliceBefore = usdc.balanceOf(users.alice);

        vm.prank(address(safe));
        vm.expectRevert(abi.encodeWithSelector(IPayments.TokenCallReturnedFalse.selector, address(falseToken)));
        payments.sendBatch(items);

        assertEq(usdc.balanceOf(users.alice), aliceBefore, "nothing paid");
        for (uint256 i; i < length; ++i) {
            assertFalse(payments.paid(items[i].paymentId), "nothing consumed");
        }
    }
}
