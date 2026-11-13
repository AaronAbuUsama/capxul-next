// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Base_Test } from "../../Base.t.sol";

import { Escrow } from "../../../src/money/Escrow.sol";
import { EscrowFactory } from "../../../src/money/EscrowFactory.sol";
import { IEscrow } from "../../../src/interfaces/IEscrow.sol";
import { IPayments } from "../../../src/interfaces/IPayments.sol";

import { AuthorityMock } from "./AuthorityMock.sol";
import { OwnerSafeMock } from "./OwnerSafeMock.sol";
import { Payments } from "../../../src/money/Payments.sol";

/// @notice The general escrow tests' base (docs/design/escrow.md). The sender is the company Safe. Companies
/// House is the bootstrap owner of every owner-collects escrow here. `claimedOwner` is Alice's Safe after
/// Companies House swapped itself out. `unclaimedOwner` still lists Companies House as its only owner.
/// `authority` stands in for v4 Budgets: a department's escrow names it with `BUDGET_ID`.
abstract contract Escrow_Test is Base_Test {
    uint8 internal constant AMOUNT_REACHED = 0; // CONDITION_AMOUNT_REACHED, an invoice
    uint8 internal constant OWNER_COLLECTS = 1; // CONDITION_OWNER_COLLECTS, a claim escrow
    uint256 internal constant AMOUNT = 100 * USDC_UNIT;
    uint16 internal constant KIND = 1; // invoice
    bytes32 internal constant JOB_NONCE = bytes32(uint256(1));
    bytes32 internal constant DOC = keccak256("invoice 2026-001");
    bytes32 internal constant SALT = keccak256("job 1");
    uint256 internal constant BUDGET_ID = 7;

    address internal companiesHouse;
    address internal sender; // the company Safe, where a refund goes
    Payments internal payments;
    EscrowFactory internal factory;
    AuthorityMock internal authority;
    OwnerSafeMock internal claimedOwner;
    OwnerSafeMock internal unclaimedOwner;

    function _deployProtocol() internal virtual override {
        companiesHouse = makeAddr("companies house");
        sender = address(safe);
        payments = new Payments();
        factory = new EscrowFactory(address(payments), companiesHouse);
        authority = new AuthorityMock();
        claimedOwner = _ownerSafe(users.alice);
        unclaimedOwner = _ownerSafe(companiesHouse);
        vm.label(address(payments), "Payments");
        vm.label(address(factory), "EscrowFactory");
        vm.label(address(authority), "Authority (Budgets)");
        vm.label(address(claimedOwner), "Alice's Safe (claimed)");
        vm.label(address(unclaimedOwner), "Unclaimed Safe");
    }

    function _ownerSafe(address firstOwner) internal returns (OwnerSafeMock) {
        address[] memory owners = new address[](1);
        owners[0] = firstOwner;
        return new OwnerSafeMock(owners);
    }

    /// @dev Terms with no authority and the surplus to the sender. An owner-collects escrow names Companies
    /// House as its bootstrap owner, as a mailbox's claim escrow does; an amount-reached one names none.
    function _terms(address owner_, uint8 condition) internal view returns (IEscrow.Terms memory) {
        return IEscrow.Terms({
            owner: owner_,
            sender: sender,
            authority: address(0),
            authorityKey: 0,
            bootstrapOwner: condition == OWNER_COLLECTS ? companiesHouse : address(0),
            token: address(usdc),
            amount: AMOUNT,
            jobNonce: JOB_NONCE,
            kind: KIND,
            documentHash: DOC,
            condition: condition,
            ownerTakesSurplus: false
        });
    }

    /// @dev A department's claim escrow: authority the budgets stand-in, key the budget id.
    function _departmentTerms(address owner_) internal view returns (IEscrow.Terms memory terms) {
        terms = _terms(owner_, OWNER_COLLECTS);
        terms.authority = address(authority);
        terms.authorityKey = BUDGET_ID;
    }

    /// @dev Deploys straight from the Escrow constructor, so Escrow's tests do not depend on the factory.
    function _escrow(IEscrow.Terms memory terms) internal returns (IEscrow) {
        return IEscrow(address(new Escrow(terms, address(payments))));
    }

    function _invoiceEscrow() internal returns (IEscrow) {
        return _escrow(_terms(users.bob, AMOUNT_REACHED));
    }

    function _claimEscrow(OwnerSafeMock owner_) internal returns (IEscrow) {
        return _escrow(_terms(address(owner_), OWNER_COLLECTS));
    }

    /// @dev The item the escrow sends: the fixed terms, executor the escrow for an owner-collects escrow.
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
            recipient: terms.owner,
            token: terms.token,
            amount: terms.amount,
            kind: terms.kind,
            documentHash: terms.documentHash,
            jobNonce: terms.jobNonce,
            executor: terms.condition == OWNER_COLLECTS ? escrow : address(0)
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
