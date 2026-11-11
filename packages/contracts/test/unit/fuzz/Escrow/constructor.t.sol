// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Escrow } from "../../../../src/money/Escrow.sol";
import { IEscrow } from "../../../../src/interfaces/IEscrow.sol";

import { Escrow_Test } from "../../../utils/Escrow/Escrow_Test.sol";

/// @notice Fuzz ranges for trees/Escrow/constructor.tree.
contract Constructor_Escrow_Unit_Fuzz_Test is Escrow_Test {
    /// @dev Leaf "when the condition is above 1": every condition in [2, 255].
    function testFuzz_RevertWhen_TheConditionIsAbove1(uint8 condition) external {
        condition = uint8(bound(condition, 2, type(uint8).max));
        vm.expectRevert(abi.encodeWithSelector(IEscrow.InvalidCondition.selector, condition));
        new Escrow(_terms(users.bob, condition), address(payments), companiesHouse);
    }

    /// @dev Leaf "when the terms are valid": any nonzero amount, nonce and document, any kind, both conditions.
    function testFuzz_WhenTheTermsAreValid(
        uint256 amount,
        bytes32 jobNonce,
        uint16 kind,
        bytes32 doc,
        bool claim
    )
        external
    {
        vm.assume(jobNonce != bytes32(0) && doc != bytes32(0));
        IEscrow.Terms memory terms = _terms(address(claimedPayee), claim ? CLAIM : INVOICE);
        terms.amount = bound(amount, 1, type(uint256).max);
        terms.jobNonce = jobNonce;
        terms.kind = kind;
        terms.documentHash = doc;
        IEscrow escrow = _escrow(terms);
        assertEq(escrow.amount(), terms.amount, "amount");
        assertEq(escrow.jobNonce(), jobNonce, "jobNonce");
        assertEq(escrow.kind(), kind, "kind");
        assertEq(escrow.documentHash(), doc, "documentHash");
        assertEq(escrow.condition(), terms.condition, "condition");
        assertEq(escrow.paymentId(), _item(terms, address(escrow)).paymentId, "payment id with its executor");
    }
}
