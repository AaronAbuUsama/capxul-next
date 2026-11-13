// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Escrow } from "../../../../src/money/Escrow.sol";
import { IEscrow } from "../../../../src/interfaces/IEscrow.sol";

import { Escrow_Test } from "../../../utils/Escrow/Escrow_Test.sol";

/// @notice Fuzz ranges for unit/concrete/Escrow/constructor/constructor.tree.
contract Constructor_Escrow_Unit_Fuzz_Test is Escrow_Test {
    /// @dev Leaf "when the condition is above 1": every condition in [2, 255].
    function testFuzz_RevertWhen_TheConditionIsAbove1(uint8 condition) external {
        condition = uint8(bound(condition, 2, type(uint8).max));
        vm.expectRevert(abi.encodeWithSelector(IEscrow.InvalidCondition.selector, condition));
        new Escrow(_terms(users.bob, condition), address(payments));
    }

    /// @dev Leaf "when the terms are valid": any nonzero amount, nonce and document, any kind, authority, key,
    /// bootstrap owner and surplus routing, both conditions.
    function testFuzz_WhenTheTermsAreValid(
        uint256 amount,
        bytes32 jobNonce,
        uint16 kind,
        bytes32 doc,
        bool ownerCollects,
        address authority_,
        uint256 authorityKey,
        address bootstrapOwner,
        bool ownerTakesSurplus
    )
        external
    {
        vm.assume(jobNonce != bytes32(0) && doc != bytes32(0));
        IEscrow.Terms memory terms = _terms(address(claimedOwner), ownerCollects ? OWNER_COLLECTS : AMOUNT_REACHED);
        terms.amount = bound(amount, 1, type(uint256).max);
        terms.jobNonce = jobNonce;
        terms.kind = kind;
        terms.documentHash = doc;
        terms.authority = authority_;
        terms.authorityKey = authorityKey;
        terms.bootstrapOwner = bootstrapOwner;
        terms.ownerTakesSurplus = ownerTakesSurplus;
        IEscrow escrow = _escrow(terms);
        assertEq(escrow.amount(), terms.amount, "amount");
        assertEq(escrow.jobNonce(), jobNonce, "jobNonce");
        assertEq(escrow.kind(), kind, "kind");
        assertEq(escrow.documentHash(), doc, "documentHash");
        assertEq(escrow.condition(), terms.condition, "condition");
        assertEq(escrow.authority(), authority_, "authority");
        assertEq(escrow.authorityKey(), authorityKey, "authorityKey");
        assertEq(escrow.bootstrapOwner(), bootstrapOwner, "bootstrapOwner");
        assertEq(escrow.ownerTakesSurplus(), ownerTakesSurplus, "ownerTakesSurplus");
        assertEq(escrow.paymentId(), _item(terms, address(escrow)).paymentId, "payment id with its executor");
    }
}
