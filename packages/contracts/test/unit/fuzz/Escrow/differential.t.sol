// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { CapxulEscrow } from "@beta/CapxulEscrow.sol";
import { CapxulPaymentsV3 } from "@beta/CapxulPaymentsV3.sol";
import { IEscrow } from "../../../../src/interfaces/IEscrow.sol";
import { IPayments } from "../../../../src/interfaces/IPayments.sol";
import { Escrow } from "../../../../src/money/Escrow.sol";
import { Payments } from "../../../../src/money/Payments.sol";
import { Escrow_Test } from "../../../utils/Escrow/Escrow_Test.sol";

/// @notice Differential fuzz: the general Escrow, configured as v4 used it (no authority, Companies House as the
/// bootstrap owner of an owner-collects escrow, the surplus to the sender), against beta CapxulEscrow: payout,
/// collect and refund of the same terms, funding and callers. Final state, the owner, sender and escrow balances
/// must match, and so must revert data, with the two renamed refusals mapped: beta's `NotPayee` is `NotOwner`,
/// beta's `NotOwner` is `CannotRefund(caller)`. The owner-collects condition is only compared where D11 and beta
/// agree (an owner Safe with one owner: Companies House, or someone else).
contract Differential_Escrow_Unit_Fuzz_Test is Escrow_Test {
    CapxulPaymentsV3 internal betaPayments;

    struct Settled {
        address escrow;
        bytes32 id;
        uint256 payee;
        uint256 owner;
    }

    struct Outcome {
        bool ok;
        bytes data;
        uint256 state;
        uint256 payee;
        uint256 owner;
        uint256 escrow;
    }

    function _deployProtocol() internal override {
        super._deployProtocol();
        betaPayments = new CapxulPaymentsV3();
    }

    function testFuzz_differential_payoutCollectRefund(
        uint8 condition,
        bool claimedOwnerSel,
        uint256 funding,
        bool paidDirectly,
        uint8[3] memory actions
    )
        external
    {
        condition = uint8(bound(condition, 0, 1));
        funding = bound(funding, 0, 3 * AMOUNT);
        address payee =
            condition == OWNER_COLLECTS ? address(claimedOwnerSel ? claimedOwner : unclaimedOwner) : users.bob;
        IEscrow.Terms memory terms = _terms(payee, condition);
        CapxulEscrow.Terms memory betaTerms = CapxulEscrow.Terms({
            ownerSafe: terms.sender,
            payeeSafe: terms.owner,
            token: terms.token,
            amount: terms.amount,
            jobNonce: terms.jobNonce,
            kind: terms.kind,
            documentHash: terms.documentHash,
            condition: terms.condition
        });
        IEscrow v4 = IEscrow(address(new Escrow(terms, address(payments))));
        CapxulEscrow beta = new CapxulEscrow(betaTerms, address(betaPayments), companiesHouse);
        assertEq(v4.paymentId() == bytes32(0), false);

        usdc.mint(address(v4), funding);
        usdc.mint(address(beta), funding);
        if (paidDirectly && condition == AMOUNT_REACHED) {
            _payV4(terms, address(v4));
            _payBeta(betaTerms, address(beta));
        }

        for (uint256 i; i < actions.length; ++i) {
            (bytes memory cd, address caller) = _action(actions[i], terms);
            Outcome memory a = _run(address(v4), cd, caller, terms);
            Outcome memory b = _run(address(beta), cd, caller, terms);
            assertEq(a.ok, b.ok, "ok");
            assertEq(a.data, _renamed(b.data, caller), "revert data");
            assertEq(a.state, b.state, "state");
            assertEq(a.payee, b.payee, "payee delta");
            assertEq(a.owner, b.owner, "owner delta");
            assertEq(a.escrow, b.escrow, "escrow balance");
        }
    }

    /// @dev The payout through v4 Payments yields the same payment id as beta (spec: renames only). The real
    /// v4 `Payments` and beta `CapxulPaymentsV3` sit at the same address (the id binds the router) and each
    /// escrow is deployed at the same address (a claim id binds the escrow as executor), one world at a time.
    /// The escrow's id, the id Payments consumes and the balances it moves must match.
    function testFuzz_differential_paymentIdThroughV4Payments(
        bool claim,
        uint256 amount,
        uint256 surplus,
        uint16 kind,
        bytes32 jobNonce,
        bytes32 documentHash
    )
        external
    {
        vm.assume(jobNonce != bytes32(0) && documentHash != bytes32(0));
        IEscrow.Terms memory terms =
            _terms(claim ? address(claimedOwner) : users.bob, claim ? OWNER_COLLECTS : AMOUNT_REACHED);
        terms.amount = bound(amount, 1, 1e36);
        terms.kind = kind;
        terms.jobNonce = jobNonce;
        terms.documentHash = documentHash;
        surplus = bound(surplus, 0, 1e36);
        address router = address(new Payments());

        uint256 world = vm.snapshotState();
        Settled memory v4 = _settleV4(terms, router, surplus);
        vm.revertToState(world);
        vm.etch(router, address(betaPayments).code);
        Settled memory beta = _settleBeta(terms, router, surplus);

        assertEq(v4.escrow, beta.escrow, "same escrow address");
        assertEq(v4.id, beta.id, "same payment id");
        assertEq(v4.payee, beta.payee, "payee delta");
        assertEq(v4.owner, beta.owner, "owner delta");
        assertEq(v4.payee, terms.amount, "payee gets exactly the amount");
        assertEq(v4.owner, surplus, "sender gets the surplus");
    }

    function _settleV4(IEscrow.Terms memory terms, address router, uint256 surplus) private returns (Settled memory o) {
        address escrow = address(new Escrow(terms, router));
        bytes32 id = IEscrow(escrow).paymentId();
        (o.escrow, o.id) = (escrow, id);
        usdc.mint(escrow, terms.amount + surplus);
        uint256 payeeBefore = usdc.balanceOf(terms.owner);
        uint256 ownerBefore = usdc.balanceOf(terms.sender);
        vm.prank(terms.condition == OWNER_COLLECTS ? terms.owner : users.eve);
        if (terms.condition == OWNER_COLLECTS) IEscrow(escrow).collect();
        else IEscrow(escrow).payout();
        assertTrue(Payments(router).paid(id), "v4 Payments consumed the escrow's id");
        o.payee = usdc.balanceOf(terms.owner) - payeeBefore;
        o.owner = usdc.balanceOf(terms.sender) - ownerBefore;
    }

    function _settleBeta(
        IEscrow.Terms memory terms,
        address router,
        uint256 surplus
    )
        private
        returns (Settled memory o)
    {
        CapxulEscrow.Terms memory t = CapxulEscrow.Terms({
            ownerSafe: terms.sender,
            payeeSafe: terms.owner,
            token: terms.token,
            amount: terms.amount,
            jobNonce: terms.jobNonce,
            kind: terms.kind,
            documentHash: terms.documentHash,
            condition: terms.condition
        });
        address escrow = address(new CapxulEscrow(t, router, companiesHouse));
        bytes32 id = CapxulEscrow(escrow).settlementId();
        (o.escrow, o.id) = (escrow, id);
        usdc.mint(escrow, terms.amount + surplus);
        uint256 payeeBefore = usdc.balanceOf(terms.owner);
        uint256 ownerBefore = usdc.balanceOf(terms.sender);
        vm.prank(terms.condition == OWNER_COLLECTS ? terms.owner : users.eve);
        if (terms.condition == OWNER_COLLECTS) CapxulEscrow(escrow).collect();
        else CapxulEscrow(escrow).payout();
        assertTrue(CapxulPaymentsV3(router).settled(id), "beta Payments settled the escrow's id");
        o.payee = usdc.balanceOf(terms.owner) - payeeBefore;
        o.owner = usdc.balanceOf(terms.sender) - ownerBefore;
    }

    function _action(uint8 sel, IEscrow.Terms memory terms) private view returns (bytes memory, address) {
        sel = sel % 5;
        if (sel == 0) return (abi.encodeCall(IEscrow.payout, ()), users.eve);
        if (sel == 1) return (abi.encodeCall(IEscrow.collect, ()), terms.owner);
        if (sel == 2) return (abi.encodeCall(IEscrow.collect, ()), users.eve);
        if (sel == 3) return (abi.encodeCall(IEscrow.refund, ()), terms.sender);
        return (abi.encodeCall(IEscrow.refund, ()), users.eve);
    }

    function _run(
        address escrow,
        bytes memory cd,
        address caller,
        IEscrow.Terms memory terms
    )
        private
        returns (Outcome memory o)
    {
        uint256 payeeBefore = usdc.balanceOf(terms.owner);
        uint256 ownerBefore = usdc.balanceOf(terms.sender);
        vm.prank(caller);
        (o.ok, o.data) = escrow.call(cd);
        o.state = _stateOf(escrow);
        o.payee = usdc.balanceOf(terms.owner) - payeeBefore;
        o.owner = usdc.balanceOf(terms.sender) - ownerBefore;
        o.escrow = usdc.balanceOf(escrow);
    }

    /// @dev Beta's revert data in the general escrow's words: the two refusals it renamed.
    function _renamed(bytes memory beta, address caller) private pure returns (bytes memory) {
        if (keccak256(beta) == keccak256(abi.encodeWithSelector(CapxulEscrow.NotPayee.selector))) {
            return abi.encodeWithSelector(IEscrow.NotOwner.selector);
        }
        if (keccak256(beta) == keccak256(abi.encodeWithSelector(CapxulEscrow.NotOwner.selector))) {
            return abi.encodeWithSelector(IEscrow.CannotRefund.selector, caller);
        }
        return beta;
    }

    function _stateOf(address escrow) private view returns (uint256) {
        (bool ok, bytes memory r) = escrow.staticcall(abi.encodeCall(IEscrow.state, ()));
        assertTrue(ok);
        return abi.decode(r, (uint256));
    }

    function _payV4(IEscrow.Terms memory terms, address escrow) private {
        _payDirectly(terms, escrow);
    }

    function _payBeta(CapxulEscrow.Terms memory t, address) private {
        CapxulPaymentsV3.PaymentItem memory item = CapxulPaymentsV3.PaymentItem({
            settlementId: bytes32(0),
            recipient: t.payeeSafe,
            token: t.token,
            amount: t.amount,
            kind: t.kind,
            documentHash: t.documentHash,
            jobNonce: t.jobNonce,
            executor: address(0)
        });
        item.settlementId = betaPayments.paymentId(item);
        vm.startPrank(users.eve);
        usdc.approve(address(betaPayments), item.amount);
        betaPayments.send(item);
        vm.stopPrank();
    }
}
