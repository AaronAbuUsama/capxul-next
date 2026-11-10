// Payments rules (docs/planning/protocol-v4/fv/certora.md "Payments.spec"; invariants P1-P8).
//
// Summaries
// - Every token call is DISPATCHER(true) to the three linked harnesses (fv/certora.md "ERC-20"; never AUTO or
//   HAVOC_ECF, which would assume away the re-entry P8 checks): `token` (standard), `feeToken`
//   (fee-on-transfer) and `reentrantToken` (calls back send or sendBatch from transferFrom).
// - P1 is stated for the standard harness: Payments checks only the recipient's balance, so "from the
//   caller" holds for a standard ERC-20 (spec/payments.md "Exact transfer", research R2 4.1, R4 3.2).
//
// Vacuity (verification-loop.md "TDD", ruling K7). Every rule must be red on the reverting stub under
// `--rule_sanity basic`. A rule whose only call is `@withrevert` would pass on a stub that always reverts, so
// each such rule first reads `paymentId(e, item)` or `paid(id)` without `@withrevert`: on the stub that read
// reverts, every path is pruned and the sanity check flags the rule. On the implementation those reads
// cannot revert, and requiring `item.paymentId == paymentId(e, item)` only narrows the rule to items whose
// id is right, so the refusal it proves is the guard under test, not the id check.

using PaymentsDummyERC20 as token;
using PaymentsFeeTokenHarness as feeToken;
using PaymentsReentrantTokenHarness as reentrantToken;

methods {
    function paid(bytes32) external returns (bool) envfree;
    function paymentId(IPayments.PaymentItem) external returns (bytes32);

    function token.balanceOf(address) external returns (uint256) envfree;
    function feeToken.balanceOf(address) external returns (uint256) envfree;
    function feeToken.feeOf(uint256) external returns (uint256) envfree;
    function reentrantToken.balanceOf(address) external returns (uint256) envfree;
    function reentrantToken.reentered() external returns (bool) envfree;
    function reentrantToken.reentrySucceeded() external returns (bool) envfree;
    function reentrantToken.payments() external returns (address) envfree;

    function _.transferFrom(address, address, uint256) external => DISPATCHER(true);
    function _.balanceOf(address) external => DISPATCHER(true);
}

definition onPayments(method f) returns bool = f.contract == currentContract;

/// The item carries its own correct id (see "Vacuity" above).
function requireCorrectId(env e, IPayments.PaymentItem item) {
    require item.paymentId == paymentId(e, item);
}

// ------------------------------------------------------------------ P1 exact transfer

/// P1: a send that does not revert raises the recipient's balance by exactly `amount` and lowers the
/// caller's by the same; a self-send changes nothing.
rule P1_exactTransfer(env e) {
    IPayments.PaymentItem item;
    require e.msg.sender != currentContract;
    require item.token == token;
    address recipient = item.recipient;
    address caller = e.msg.sender;
    uint256 recipientBefore = token.balanceOf(recipient);
    uint256 callerBefore = token.balanceOf(caller);

    send(e, item);

    uint256 recipientAfter = token.balanceOf(recipient);
    uint256 callerAfter = token.balanceOf(caller);
    if (recipient == caller) {
        assert recipientAfter == recipientBefore, "a self-send changed the balance";
    } else {
        assert to_mathint(recipientAfter) == recipientBefore + item.amount, "recipient got a different amount";
        assert to_mathint(callerAfter) == callerBefore - item.amount, "caller paid a different amount";
    }
}

/// P1: with a fee-on-transfer token that takes at least one unit, send reverts.
rule P1_feeTokenReverts(env e) {
    IPayments.PaymentItem item;
    require item.token == feeToken;
    require item.recipient != e.msg.sender;
    require feeToken.feeOf(item.amount) > 0;
    requireCorrectId(e, item);

    send@withrevert(e, item);

    assert lastReverted, "an inexact transfer was accepted";
}

/// P1 (liveness): a valid send with the standard token can succeed. Red on the stub without the sanity check.
rule P1_sendCanSucceed(env e) {
    IPayments.PaymentItem item;
    require item.token == token;
    requireCorrectId(e, item);

    send@withrevert(e, item);

    satisfy !lastReverted;
}

// ------------------------------------------------------------------ P2 own balance

/// P2 (restated): no Payments call changes Payments' own balance of any token. A parametric rule, not an
/// invariant: other contracts' transfers to Payments break "holds no balance" (research R4 3.2).
rule P2_ownBalanceUnchanged(env e, method f, calldataarg args) filtered { f -> onPayments(f) } {
    // Payments never calls itself; a symbolic caller equal to Payments is not a reachable state.
    require e.msg.sender != currentContract;
    uint256 tokenBefore = token.balanceOf(currentContract);
    uint256 feeBefore = feeToken.balanceOf(currentContract);
    uint256 reentrantBefore = reentrantToken.balanceOf(currentContract);

    f(e, args);

    assert token.balanceOf(currentContract) == tokenBefore, "standard token balance changed";
    assert feeToken.balanceOf(currentContract) == feeBefore, "fee token balance changed";
    assert reentrantToken.balanceOf(currentContract) == reentrantBefore, "re-entrant token balance changed";
}

// ------------------------------------------------------------------ P3 pay once

/// P3: after a successful send of an item, a second send of the same item reverts.
rule P3_payOnce(env e1, env e2) {
    IPayments.PaymentItem item;

    send(e1, item);
    send@withrevert(e2, item);

    assert lastReverted, "an id paid twice";
}

/// P3: `paid[id]` never goes from true to false.
rule P3_paidOnlyGrows(env e, method f, calldataarg args) filtered { f -> onPayments(f) } {
    bytes32 id;
    require paid(id);

    f(e, args);

    assert paid(id), "a paid id was cleared";
}

/// P3: a successful send marks exactly its own id paid.
rule P3_sendMarksItsId(env e) {
    IPayments.PaymentItem item;
    bytes32 other;
    require other != item.paymentId;
    bool otherBefore = paid(other);

    send(e, item);

    assert paid(item.paymentId), "the id was not marked paid";
    assert paid(other) == otherBefore, "another id changed";
}

// ------------------------------------------------------------------ P4 id checked

/// P4: send reverts unless the supplied id is paymentId(item).
rule P4_idChecked(env e) {
    IPayments.PaymentItem item;
    require item.paymentId != paymentId(e, item);

    send@withrevert(e, item);

    assert lastReverted, "a wrong id was accepted";
}

// ------------------------------------------------------------------ P5 executor

/// P5: an item naming a nonzero executor reverts for any other caller.
rule P5_executorOnly(env e) {
    IPayments.PaymentItem item;
    require item.executor != 0 && item.executor != e.msg.sender;
    requireCorrectId(e, item);

    send@withrevert(e, item);

    assert lastReverted, "a non-executor sent an executor-bound item";
}

// ------------------------------------------------------------------ P6 revert consumes nothing

/// P6: a reverted send leaves every id as it was.
rule P6_revertConsumesNothing(env e) {
    IPayments.PaymentItem item;
    bytes32 id;
    bool before = paid(id);

    send@withrevert(e, item);

    assert lastReverted => paid(id) == before, "a reverted send consumed an id";
}

/// P6: a two-item batch pays both items or neither.
rule P6_batchAllOrNothing(env e) {
    IPayments.PaymentItem[] items;
    require items.length == 2;
    bytes32 id0 = items[0].paymentId;
    bytes32 id1 = items[1].paymentId;
    bool before0 = paid(id0);
    bool before1 = paid(id1);

    sendBatch@withrevert(e, items);
    bool reverted = lastReverted;

    assert reverted => (paid(id0) == before0 && paid(id1) == before1), "a reverted batch consumed an id";
    assert !reverted => (paid(id0) && paid(id1)), "a successful batch left an item unpaid";
}

// ------------------------------------------------------------------ P7 not to itself

/// P7 (D9): a send to Payments itself reverts, even with the correct id.
rule P7_notToSelf(env e) {
    IPayments.PaymentItem item;
    require item.recipient == currentContract;
    requireCorrectId(e, item);

    send@withrevert(e, item);

    assert lastReverted, "Payments paid itself";
}

// ------------------------------------------------------------------ P8 re-entry

/// P8: a token that calls back send or sendBatch from transferFrom has that inner call refused, while the
/// outer send still succeeds.
rule P8_reentryReverts(env e) {
    IPayments.PaymentItem item;
    require item.token == reentrantToken;
    require reentrantToken.payments() == currentContract;
    require !reentrantToken.reentered();
    require !reentrantToken.reentrySucceeded();

    send(e, item);

    assert reentrantToken.reentered(), "the token did not re-enter";
    assert !reentrantToken.reentrySucceeded(), "a re-entrant call succeeded";
}
