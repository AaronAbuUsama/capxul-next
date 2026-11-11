// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IPayments } from "../../../../src/interfaces/IPayments.sol";

import { Budgets_Shared_Test } from "../../../utils/Budgets/Budgets_Shared_Test.sol";

/// @notice payReserved.tree over amounts and job nonces: pays exactly the amount with kind 4 and the
/// given nonce, and never touches spend.
contract PayReserved_Budgets_Unit_Fuzz_Test is Budgets_Shared_Test {
    function testFuzz_PaysExactlyWithKind4(uint128 amount, bytes32 jobNonce) external {
        _tree();
        amount = uint128(bound(amount, 1, 1_000_000 * USDC_UNIT));
        vm.assume(jobNonce != bytes32(0));
        IPayments.PaymentItem memory item = _item(users.alice, address(usdc), amount, 4, DOC, jobNonce);
        uint256 before = usdc.balanceOf(users.alice);
        vm.prank(agreements);
        bytes32 id = budgets.payReserved(offsite, users.alice, amount, DOC, jobNonce);
        assertEq(id, item.paymentId, "id");
        assertEq(usdc.balanceOf(users.alice), before + amount, "paid exactly");
        assertEq(_budget(offsite).ownSpent, 0, "spend untouched");
    }
}
