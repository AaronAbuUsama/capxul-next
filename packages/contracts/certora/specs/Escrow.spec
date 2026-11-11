// Escrow.spec (fv/certora.md, "Escrow.spec", W2). S1 to S9 are unit, fuzz and invariant tests; these
// rules add the state-machine part of S1 and S7 over every reachable state. Gate 11 runs them with
// --rule_sanity basic, so on the reverting stub every rule is flagged (K7).
//
// Summaries: the token is EscrowTokenHarness, linked (DISPATCHER(true)); Payments' `send` and `paid` and
// the payee's `isOwner` are NONDET: the rules read only the escrow's own state flag and the token.

using EscrowTokenHarness as tokenContract;

methods {
    function state() external returns (IEscrow.State) envfree;
    function condition() external returns (uint8) envfree;
    function amount() external returns (uint256) envfree;
    function ownerSafe() external returns (address) envfree;
    function tokenContract.balanceOf(address) external returns (uint256) envfree;

    function _.transfer(address, uint256) external => DISPATCHER(true);
    function _.transferFrom(address, address, uint256) external => DISPATCHER(true);
    function _.approve(address, uint256) external => DISPATCHER(true);
    function _.balanceOf(address) external => DISPATCHER(true);

    function _.send(IPayments.PaymentItem) external => NONDET;
    function _.paid(bytes32) external => NONDET;
    function _.isOwner(address) external => NONDET;
}

// S1: Paid and Refunded are final; nothing moves an escrow back to Open or between them.
rule S1_settlesOnce(method f) filtered { f -> !f.isView } {
    env e;
    calldataarg args;
    IEscrow.State before = state();
    f(e, args);
    IEscrow.State after = state();
    assert before != IEscrow.State.Open => after == before, "a settled escrow changed state";
}

// S1: after Paid or Refunded, payout and collect both revert.
rule S1_noSettlementAfterClose() {
    env e1;
    env e2;
    require state() != IEscrow.State.Open;
    payout@withrevert(e1);
    bool payoutReverted = lastReverted;
    collect@withrevert(e2);
    assert payoutReverted && lastReverted, "payout or collect succeeded after the escrow closed";
}

// S1: refund succeeds only for the owner Safe.
rule S1_onlyOwnerRefunds() {
    env e;
    require e.msg.sender != ownerSafe();
    refund@withrevert(e);
    assert lastReverted, "someone but the owner Safe refunded";
}

// S7: an open invoice escrow that holds the amount cannot be refunded (ConditionMet).
rule S7_noInvoiceRefundOnceHeld() {
    env e;
    require condition() == 0;
    require state() == IEscrow.State.Open;
    require tokenContract.balanceOf(currentContract) >= amount();
    refund@withrevert(e);
    assert lastReverted, "an invoice escrow was refunded while it held the amount";
}

// S1 and S5: a successful payout or collect leaves the escrow Paid.
rule S5_settlementMarksPaid(method f) filtered {
    f -> f.selector == sig:payout().selector || f.selector == sig:collect().selector
} {
    env e;
    calldataarg args;
    f(e, args);
    assert state() == IEscrow.State.Paid, "a settlement did not mark the escrow paid";
}
