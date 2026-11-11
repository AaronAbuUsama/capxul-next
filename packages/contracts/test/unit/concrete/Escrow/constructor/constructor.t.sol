// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Escrow } from "../../../../../src/money/Escrow.sol";
import { IEscrow } from "../../../../../src/interfaces/IEscrow.sol";

import { Escrow_Test } from "../../../../utils/Escrow/Escrow_Test.sol";

contract Constructor_Escrow_Unit_Concrete_Test is Escrow_Test {
    function test_WhenTheOwnerSafeOrThePayeeSafeOrTheTokenIsTheZeroAddress() external {
        IEscrow.Terms memory terms = _terms(users.bob, INVOICE);
        terms.ownerSafe = address(0);
        // it should revert with ZeroAddress
        vm.expectRevert(IEscrow.ZeroAddress.selector);
        new Escrow(terms, address(payments), companiesHouse);

        terms = _terms(users.bob, INVOICE);
        terms.payeeSafe = address(0);
        vm.expectRevert(IEscrow.ZeroAddress.selector);
        new Escrow(terms, address(payments), companiesHouse);

        terms = _terms(users.bob, INVOICE);
        terms.token = address(0);
        vm.expectRevert(IEscrow.ZeroAddress.selector);
        new Escrow(terms, address(payments), companiesHouse);
    }

    function test_WhenThePaymentsContractOrTheBootstrapOwnerIsTheZeroAddress() external {
        IEscrow.Terms memory terms = _terms(users.bob, INVOICE);
        // it should revert with ZeroAddress
        vm.expectRevert(IEscrow.ZeroAddress.selector);
        new Escrow(terms, address(0), companiesHouse);
        vm.expectRevert(IEscrow.ZeroAddress.selector);
        new Escrow(terms, address(payments), address(0));
    }

    function test_WhenTheAmountIs0() external {
        IEscrow.Terms memory terms = _terms(users.bob, INVOICE);
        terms.amount = 0;
        // it should revert with ZeroAmount
        vm.expectRevert(IEscrow.ZeroAmount.selector);
        new Escrow(terms, address(payments), companiesHouse);
    }

    function test_WhenTheJobNonceIsZero() external {
        IEscrow.Terms memory terms = _terms(users.bob, INVOICE);
        terms.jobNonce = bytes32(0);
        // it should revert with ZeroJobNonce
        vm.expectRevert(IEscrow.ZeroJobNonce.selector);
        new Escrow(terms, address(payments), companiesHouse);
    }

    function test_WhenTheDocumentHashIsZero() external {
        IEscrow.Terms memory terms = _terms(users.bob, INVOICE);
        terms.documentHash = bytes32(0);
        // it should revert with ZeroDocumentHash
        vm.expectRevert(IEscrow.ZeroDocumentHash.selector);
        new Escrow(terms, address(payments), companiesHouse);
    }

    function test_WhenTheConditionIsAbove1() external {
        IEscrow.Terms memory terms = _terms(users.bob, 2);
        // it should revert with InvalidCondition
        vm.expectRevert(abi.encodeWithSelector(IEscrow.InvalidCondition.selector, uint8(2)));
        new Escrow(terms, address(payments), companiesHouse);
    }

    modifier whenTheTermsAreValid() {
        _;
    }

    function test_WhenTheTermsAreValid() external whenTheTermsAreValid {
        IEscrow.Terms memory terms = _terms(address(claimedPayee), CLAIM);
        terms.kind = 3;
        address expected = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        bytes32 id = _item(terms, expected).paymentId;

        // it should emit EscrowCreated
        vm.expectEmit(true, true, true, true, expected);
        emit IEscrow.EscrowCreated(owner, address(claimedPayee), id, address(usdc), AMOUNT, 3, DOC, CLAIM);
        IEscrow escrow = _escrow(terms);

        // it should store every term as an immutable
        assertEq(address(escrow), expected, "address");
        assertEq(escrow.ownerSafe(), owner, "ownerSafe");
        assertEq(escrow.payeeSafe(), address(claimedPayee), "payeeSafe");
        assertEq(escrow.token(), address(usdc), "token");
        assertEq(escrow.amount(), AMOUNT, "amount");
        assertEq(escrow.jobNonce(), JOB_NONCE, "jobNonce");
        assertEq(escrow.kind(), 3, "kind");
        assertEq(escrow.documentHash(), DOC, "documentHash");
        assertEq(escrow.condition(), CLAIM, "condition");
        assertEq(address(escrow.payments()), address(payments), "payments");
        assertEq(escrow.bootstrapOwner(), companiesHouse, "bootstrapOwner");
        assertEq(escrow.CONDITION_INVOICE_AMOUNT_REACHED(), 0, "condition 0");
        assertEq(escrow.CONDITION_PAYEE_CLAIMED(), 1, "condition 1");
        assertEq(_state(escrow), uint256(IEscrow.State.Open), "state");
        // it should compute the payment id from Payments for the fixed item
        assertEq(escrow.paymentId(), id, "paymentId");
    }

    function test_GivenTheConditionIsPayeeClaimed() external whenTheTermsAreValid {
        IEscrow.Terms memory terms = _terms(address(claimedPayee), CLAIM);
        IEscrow escrow = _escrow(terms);
        // it should make the escrow the payment's executor
        assertEq(escrow.paymentId(), _item(terms, address(escrow)).paymentId, "executor is the escrow");
        assertNotEq(escrow.paymentId(), _item(_terms(address(claimedPayee), INVOICE), address(0)).paymentId);
    }

    function test_GivenTheConditionIsInvoiceAmountReached() external whenTheTermsAreValid {
        IEscrow.Terms memory terms = _terms(users.bob, INVOICE);
        IEscrow escrow = _escrow(terms);
        // it should leave the executor empty
        assertEq(escrow.paymentId(), _item(terms, address(0)).paymentId, "executor is empty");
    }
}
