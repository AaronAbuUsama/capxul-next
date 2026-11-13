// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Escrow } from "../../../../../src/money/Escrow.sol";
import { IEscrow } from "../../../../../src/interfaces/IEscrow.sol";

import { Escrow_Test } from "../../../../utils/Escrow/Escrow_Test.sol";

contract Constructor_Escrow_Unit_Concrete_Test is Escrow_Test {
    function test_WhenTheOwnerOrTheSenderOrTheTokenIsTheZeroAddress() external {
        IEscrow.Terms memory terms = _terms(users.bob, AMOUNT_REACHED);
        terms.owner = address(0);
        // it should revert with ZeroAddress
        vm.expectRevert(IEscrow.ZeroAddress.selector);
        new Escrow(terms, address(payments));

        terms = _terms(users.bob, AMOUNT_REACHED);
        terms.sender = address(0);
        vm.expectRevert(IEscrow.ZeroAddress.selector);
        new Escrow(terms, address(payments));

        terms = _terms(users.bob, AMOUNT_REACHED);
        terms.token = address(0);
        vm.expectRevert(IEscrow.ZeroAddress.selector);
        new Escrow(terms, address(payments));
    }

    function test_WhenThePaymentsContractIsTheZeroAddress() external {
        // it should revert with ZeroAddress
        vm.expectRevert(IEscrow.ZeroAddress.selector);
        new Escrow(_terms(users.bob, AMOUNT_REACHED), address(0));
    }

    function test_WhenTheAmountIs0() external {
        IEscrow.Terms memory terms = _terms(users.bob, AMOUNT_REACHED);
        terms.amount = 0;
        // it should revert with ZeroAmount
        vm.expectRevert(IEscrow.ZeroAmount.selector);
        new Escrow(terms, address(payments));
    }

    function test_WhenTheJobNonceIsZero() external {
        IEscrow.Terms memory terms = _terms(users.bob, AMOUNT_REACHED);
        terms.jobNonce = bytes32(0);
        // it should revert with ZeroJobNonce
        vm.expectRevert(IEscrow.ZeroJobNonce.selector);
        new Escrow(terms, address(payments));
    }

    function test_WhenTheDocumentHashIsZero() external {
        IEscrow.Terms memory terms = _terms(users.bob, AMOUNT_REACHED);
        terms.documentHash = bytes32(0);
        // it should revert with ZeroDocumentHash
        vm.expectRevert(IEscrow.ZeroDocumentHash.selector);
        new Escrow(terms, address(payments));
    }

    function test_WhenTheConditionIsAbove1() external {
        IEscrow.Terms memory terms = _terms(users.bob, 2);
        // it should revert with InvalidCondition
        vm.expectRevert(abi.encodeWithSelector(IEscrow.InvalidCondition.selector, uint8(2)));
        new Escrow(terms, address(payments));
    }

    function test_WhenTheAuthorityItsKeyAndTheBootstrapOwnerAreZero() external {
        IEscrow.Terms memory terms = _terms(users.bob, OWNER_COLLECTS);
        terms.bootstrapOwner = address(0);
        // it should accept the terms
        IEscrow escrow = _escrow(terms);
        assertEq(escrow.authority(), address(0), "no authority");
        assertEq(escrow.bootstrapOwner(), address(0), "no bootstrap owner");
    }

    modifier whenTheTermsAreValid() {
        _;
    }

    function test_WhenTheTermsAreValid() external whenTheTermsAreValid {
        IEscrow.Terms memory terms = _departmentTerms(address(claimedOwner));
        terms.kind = 3;
        terms.ownerTakesSurplus = true;
        address expected = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        bytes32 id = _item(terms, expected).paymentId;

        // it should emit EscrowCreated with the authority and its key
        vm.expectEmit(true, true, true, true, expected);
        emit IEscrow.EscrowCreated(
            address(claimedOwner),
            sender,
            id,
            address(usdc),
            AMOUNT,
            3,
            DOC,
            OWNER_COLLECTS,
            address(authority),
            BUDGET_ID
        );
        IEscrow escrow = _escrow(terms);

        // it should store every term as an immutable
        assertEq(address(escrow), expected, "address");
        assertEq(escrow.owner(), address(claimedOwner), "owner");
        assertEq(escrow.sender(), sender, "sender");
        assertEq(escrow.authority(), address(authority), "authority");
        assertEq(escrow.authorityKey(), BUDGET_ID, "authorityKey");
        assertEq(escrow.bootstrapOwner(), companiesHouse, "bootstrapOwner");
        assertEq(escrow.token(), address(usdc), "token");
        assertEq(escrow.amount(), AMOUNT, "amount");
        assertEq(escrow.jobNonce(), JOB_NONCE, "jobNonce");
        assertEq(escrow.kind(), 3, "kind");
        assertEq(escrow.documentHash(), DOC, "documentHash");
        assertEq(escrow.condition(), OWNER_COLLECTS, "condition");
        assertTrue(escrow.ownerTakesSurplus(), "ownerTakesSurplus");
        assertEq(address(escrow.payments()), address(payments), "payments");
        assertEq(escrow.CONDITION_AMOUNT_REACHED(), 0, "condition 0");
        assertEq(escrow.CONDITION_OWNER_COLLECTS(), 1, "condition 1");
        assertEq(_state(escrow), uint256(IEscrow.State.Open), "state");
        // it should compute the payment id from Payments for the fixed item
        assertEq(escrow.paymentId(), id, "paymentId");
    }

    function test_GivenTheConditionIsOwnerCollects() external whenTheTermsAreValid {
        IEscrow.Terms memory terms = _terms(address(claimedOwner), OWNER_COLLECTS);
        IEscrow escrow = _escrow(terms);
        // it should make the escrow the payment's executor
        assertEq(escrow.paymentId(), _item(terms, address(escrow)).paymentId, "executor is the escrow");
        assertNotEq(escrow.paymentId(), _item(_terms(address(claimedOwner), AMOUNT_REACHED), address(0)).paymentId);
    }

    function test_GivenTheConditionIsAmountReached() external whenTheTermsAreValid {
        IEscrow.Terms memory terms = _terms(users.bob, AMOUNT_REACHED);
        IEscrow escrow = _escrow(terms);
        // it should leave the executor empty
        assertEq(escrow.paymentId(), _item(terms, address(0)).paymentId, "executor is empty");
    }
}
