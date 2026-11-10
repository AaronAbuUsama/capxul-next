// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Base_Test } from "../../Base.t.sol";

import { Escrow } from "../../../src/money/Escrow.sol";
import { EscrowFactory } from "../../../src/money/EscrowFactory.sol";
import { IEscrow } from "../../../src/interfaces/IEscrow.sol";
import { IPayments } from "../../../src/interfaces/IPayments.sol";

import { PayeeSafeMock } from "./PayeeSafeMock.sol";
import { Payments } from "../../../src/money/Payments.sol";

/// @notice The escrow tests' base (spec/escrow.md). The payer is the company Safe; Companies House is
/// the bootstrap owner; `claimedPayee` is Alice's Safe after Companies House swapped itself out, and
/// `unclaimedPayee` still lists Companies House as its only owner.
abstract contract Escrow_Test is Base_Test {
    uint8 internal constant INVOICE = 0; // CONDITION_INVOICE_AMOUNT_REACHED
    uint8 internal constant CLAIM = 1; // CONDITION_PAYEE_CLAIMED
    uint256 internal constant AMOUNT = 100 * USDC_UNIT;
    uint16 internal constant KIND = 1; // invoice
    bytes32 internal constant JOB_NONCE = bytes32(uint256(1));
    bytes32 internal constant DOC = keccak256("invoice 2026-001");
    bytes32 internal constant SALT = keccak256("job 1");

    address internal companiesHouse;
    address internal owner; // the payer Safe
    Payments internal payments;
    EscrowFactory internal factory;
    PayeeSafeMock internal claimedPayee;
    PayeeSafeMock internal unclaimedPayee;

    function _deployProtocol() internal virtual override {
        companiesHouse = makeAddr("companies house");
        owner = address(safe);
        payments = new Payments();
        factory = new EscrowFactory(address(payments), companiesHouse);
        claimedPayee = _payee(users.alice);
        unclaimedPayee = _payee(companiesHouse);
        vm.label(address(payments), "Payments");
        vm.label(address(factory), "EscrowFactory");
        vm.label(address(claimedPayee), "Alice's Safe (claimed)");
        vm.label(address(unclaimedPayee), "Unclaimed Safe");
    }

    function _payee(address firstOwner) internal returns (PayeeSafeMock) {
        address[] memory owners = new address[](1);
        owners[0] = firstOwner;
        return new PayeeSafeMock(owners);
    }

    function _terms(address payee, uint8 condition) internal view returns (IEscrow.Terms memory) {
        return IEscrow.Terms({
            ownerSafe: owner,
            payeeSafe: payee,
            token: address(usdc),
            amount: AMOUNT,
            jobNonce: JOB_NONCE,
            kind: KIND,
            documentHash: DOC,
            condition: condition
        });
    }

    /// @dev Deploys straight from the Escrow constructor, so Escrow's tests do not depend on the factory.
    function _escrow(IEscrow.Terms memory terms) internal returns (IEscrow) {
        return IEscrow(address(new Escrow(terms, address(payments), companiesHouse)));
    }

    function _invoiceEscrow() internal returns (IEscrow) {
        return _escrow(_terms(users.bob, INVOICE));
    }

    function _claimEscrow(PayeeSafeMock payee) internal returns (IEscrow) {
        return _escrow(_terms(address(payee), CLAIM));
    }

    /// @dev The item the escrow sends: the fixed terms, executor the escrow for a claim escrow.
    function _item(
        IEscrow.Terms memory terms,
        address escrow
    )
        internal
        view
        returns (IPayments.PaymentItem memory item)
    {
        item = IPayments.PaymentItem({
            paymentId: bytes32(0),
            recipient: terms.payeeSafe,
            token: terms.token,
            amount: terms.amount,
            kind: terms.kind,
            documentHash: terms.documentHash,
            jobNonce: terms.jobNonce,
            executor: terms.condition == CLAIM ? escrow : address(0)
        });
        item.paymentId = payments.paymentId(item);
    }

    /// @dev Someone other than the escrow pays the escrow's invoice item straight through Payments.
    function _payDirectly(IEscrow.Terms memory terms, address escrow) internal {
        IPayments.PaymentItem memory item = _item(terms, escrow);
        vm.startPrank(users.eve);
        usdc.approve(address(payments), item.amount);
        payments.send(item);
        vm.stopPrank();
    }

    function _state(IEscrow escrow) internal view returns (uint256) {
        return uint256(escrow.state());
    }
}
