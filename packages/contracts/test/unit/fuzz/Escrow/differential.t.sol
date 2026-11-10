// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { CapxulEscrow } from "@beta/CapxulEscrow.sol";
import { CapxulPaymentsV3 } from "@beta/CapxulPaymentsV3.sol";
import { IEscrow } from "../../../../src/interfaces/IEscrow.sol";
import { IPayments } from "../../../../src/interfaces/IPayments.sol";
import { Escrow } from "../../../../src/money/Escrow.sol";
import { Payments } from "../../../../src/money/Payments.sol";
import { Escrow_Test } from "../../../utils/Escrow/Escrow_Test.sol";

/// @notice Differential fuzz (plan, D11/D12): v4 Escrow against beta CapxulEscrow on the paths that did not
/// change: payout, collect and refund of the same terms, funding and callers. Revert data, final state and
/// the payee, owner and escrow balances must match. The claim condition is only compared where D11 and beta
/// agree (a payee with one owner: Companies House, or someone else).
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
        bool claimedPayeeSel,
        uint256 funding,
        bool paidDirectly,
        uint8[3] memory actions
    )
        external
    {
        condition = uint8(bound(condition, 0, 1));
        funding = bound(funding, 0, 3 * AMOUNT);
        address payee = condition == CLAIM ? address(claimedPayeeSel ? claimedPayee : unclaimedPayee) : users.bob;
        IEscrow.Terms memory terms = _terms(payee, condition);
        CapxulEscrow.Terms memory betaTerms = CapxulEscrow.Terms({
            ownerSafe: terms.ownerSafe,
            payeeSafe: terms.payeeSafe,
            token: terms.token,
            amount: terms.amount,
            jobNonce: terms.jobNonce,
            kind: terms.kind,
            documentHash: terms.documentHash,
            condition: terms.condition
        });
        IEscrow v4 = IEscrow(address(new Escrow(terms, address(payments), companiesHouse)));
        CapxulEscrow beta = new CapxulEscrow(betaTerms, address(betaPayments), companiesHouse);
        assertEq(v4.paymentId() == bytes32(0), false);

        usdc.mint(address(v4), funding);
        usdc.mint(address(beta), funding);
        if (paidDirectly && condition == INVOICE) {
            _payV4(terms, address(v4));
            _payBeta(betaTerms, address(beta));
        }

        for (uint256 i; i < actions.length; ++i) {
            (bytes memory cd, address caller) = _action(actions[i], terms);
            Outcome memory a = _run(address(v4), cd, caller, terms);
            Outcome memory b = _run(address(beta), cd, caller, terms);
            assertEq(a.ok, b.ok, "ok");
            assertEq(a.data, b.data, "revert data");
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
        IEscrow.Terms memory terms = _terms(claim ? address(claimedPayee) : users.bob, claim ? CLAIM : INVOICE);
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
        assertEq(v4.owner, surplus, "owner gets the surplus");
    }

    function _settleV4(IEscrow.Terms memory terms, address router, uint256 surplus) private returns (Settled memory o) {
        address escrow = address(new Escrow(terms, router, companiesHouse));
        bytes32 id = IEscrow(escrow).paymentId();
        (o.escrow, o.id) = (escrow, id);
        usdc.mint(escrow, terms.amount + surplus);
        uint256 payeeBefore = usdc.balanceOf(terms.payeeSafe);
        uint256 ownerBefore = usdc.balanceOf(terms.ownerSafe);
        vm.prank(terms.condition == CLAIM ? terms.payeeSafe : users.eve);
        if (terms.condition == CLAIM) IEscrow(escrow).collect();
        else IEscrow(escrow).payout();
        assertTrue(Payments(router).paid(id), "v4 Payments consumed the escrow's id");
        o.payee = usdc.balanceOf(terms.payeeSafe) - payeeBefore;
        o.owner = usdc.balanceOf(terms.ownerSafe) - ownerBefore;
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
            ownerSafe: terms.ownerSafe,
            payeeSafe: terms.payeeSafe,
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
        uint256 payeeBefore = usdc.balanceOf(terms.payeeSafe);
        uint256 ownerBefore = usdc.balanceOf(terms.ownerSafe);
        vm.prank(terms.condition == CLAIM ? terms.payeeSafe : users.eve);
        if (terms.condition == CLAIM) CapxulEscrow(escrow).collect();
        else CapxulEscrow(escrow).payout();
        assertTrue(CapxulPaymentsV3(router).settled(id), "beta Payments settled the escrow's id");
        o.payee = usdc.balanceOf(terms.payeeSafe) - payeeBefore;
        o.owner = usdc.balanceOf(terms.ownerSafe) - ownerBefore;
    }

    function _action(uint8 sel, IEscrow.Terms memory terms) private view returns (bytes memory, address) {
        sel = sel % 5;
        if (sel == 0) return (abi.encodeCall(IEscrow.payout, ()), users.eve);
        if (sel == 1) return (abi.encodeCall(IEscrow.collect, ()), terms.payeeSafe);
        if (sel == 2) return (abi.encodeCall(IEscrow.collect, ()), users.eve);
        if (sel == 3) return (abi.encodeCall(IEscrow.refund, ()), terms.ownerSafe);
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
        uint256 payeeBefore = usdc.balanceOf(terms.payeeSafe);
        uint256 ownerBefore = usdc.balanceOf(terms.ownerSafe);
        vm.prank(caller);
        (o.ok, o.data) = escrow.call(cd);
        o.state = _stateOf(escrow);
        o.payee = usdc.balanceOf(terms.payeeSafe) - payeeBefore;
        o.owner = usdc.balanceOf(terms.ownerSafe) - ownerBefore;
        o.escrow = usdc.balanceOf(escrow);
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
