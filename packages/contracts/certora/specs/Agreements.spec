// SPDX-License-Identifier: GPL-3.0-or-later
//
// Agreements rules (docs/planning/protocol-v4/fv/certora.md "Agreements.spec"; invariants A1, A4, A10, A11,
// H2, H5, and the payee rule). A2 is bounded and links the real Budgets: certora/specs/AgreementsA2.spec.
//
// Summaries
// - Budgets: every call is DISPATCHER(true) to AgreementsBudgetsHarness (free state, `authorised` from a
//   storage map, `payReserved` a fresh id that changes no Agreements storage, or, with `reenter` set, a call
//   back into Agreements: A11's callback harness). fv/certora.md replaces HAVOC_ECF with this: with the D10
//   lock proved by A11, the payout cannot write Agreements' storage.
// - Calendar: `earned` and `periodIndex` as ghosts with the C1/C2/C9 axioms (CalendarSummaries.spec).
// - Hats: AgreementsHatsHarness is in the scene; its mutators set `mutated` (H5). Agreements reads no Hats.
//
// Vacuity (verification-loop.md "TDD", K7). Each rule first reads `agreementOf(id)` without `@withrevert`. On
// the reverting stub that read reverts, every path is pruned, and `rule_sanity basic` flags the rule; on the
// implementation the read cannot revert.

import "CalendarSummaries.spec";

using AgreementsBudgetsHarness as budgets;
using AgreementsHatsHarness as hatsHarness;

methods {
    function agreementOf(uint256) external returns (IAgreements.Agreement) envfree;
    function agreementCount() external returns (uint256) envfree;

    function budgets.auth(uint256, address) external returns (bool) envfree;
    function budgets.reenter() external returns (bool) envfree;
    function budgets.reentered() external returns (bool) envfree;
    function budgets.reentrySucceeded() external returns (bool) envfree;
    function budgets.reentryError() external returns (bytes4) envfree;
    function budgets.agreements() external returns (address) envfree;
    function hatsHarness.mutated() external returns (bool) envfree;

    function _.authorised(uint256, address) external => DISPATCHER(true);
    function _.budgetOf(uint256) external => DISPATCHER(true);
    function _.leftOf(uint256) external => DISPATCHER(true);
    function _.commit(uint256, uint128) external => DISPATCHER(true);
    function _.release(uint256, uint128) external => DISPATCHER(true);
    function _.payReserved(uint256, address, uint128, bytes32, bytes32) external => DISPATCHER(true);
    // Resolve the callback by its selector; keep unknown calls adversarial.
    unresolved external in AgreementsBudgetsHarness.payReserved(uint256, address, uint128, bytes32, bytes32)
        => DISPATCH [ Agreements._ ] default HAVOC_ALL;
}

definition SCALE() returns mathint = 12 * 377580 * 86400;
definition onAgreements(method f) returns bool = f.contract == currentContract;

/// The scene: the harness answers only Agreements, and pays without calling back unless a rule says so.
function sceneWithoutReentry() {
    require budgets.agreements() == currentContract;
    require !budgets.reenter();
}

/// Budgets' `authorised` for the harness's state: the budget's Safe, or a granted wearer.
function isAuthorised(env e, uint256 budgetId) returns bool {
    return budgets.authorised(e, budgetId, e.msg.sender);
}

// ------------------------------------------------------------------ A1

/// A1: `collected * SCALE <= releasedScaled <= earnedScaled`, kept by every Agreements call.
rule A1_collectedBounded(method f, env e, calldataarg args, uint256 id) filtered { f -> onAgreements(f) && !f.isView } {
    sceneWithoutReentry();
    IAgreements.Agreement before = agreementOf(id);
    require e.block.timestamp < 2 ^ 64;
    require before.collected * SCALE() <= to_mathint(before.releasedScaled);
    require before.releasedScaled <= before.earnedScaled;
    require before.earnedScaled < 2 ^ 200; // storage bounds: uint128 pay over uint64 time in SCALE units

    f(e, args);

    IAgreements.Agreement after = agreementOf(id);
    assert after.collected * SCALE() <= to_mathint(after.releasedScaled), "collected within released";
    assert after.releasedScaled <= after.earnedScaled, "released within earned";
}

// ------------------------------------------------------------------ A4

/// A4: an acceptance succeeds only for the payee, with the exact document hash, before the expiry, once.
rule A4_payeeConsent(env e, uint256 id, bytes32 termsHash) {
    sceneWithoutReentry();
    IAgreements.Agreement before = agreementOf(id);

    accept@withrevert(e, id, termsHash);
    bool succeeded = !lastReverted;

    assert succeeded => e.msg.sender == before.payee, "only the payee";
    assert succeeded => termsHash == before.documentHash, "the exact terms";
    assert succeeded => e.block.timestamp < before.offerExpiresAt, "before the expiry";
    assert succeeded => !before.accepted && !before.closed, "a standing offer, once";
}

/// A4: nothing accrues before acceptance, whatever is called.
rule A4_nothingBeforeAcceptance(method f, env e, calldataarg args, uint256 id) filtered { f -> onAgreements(f) && !f.isView } {
    sceneWithoutReentry();
    IAgreements.Agreement before = agreementOf(id);
    require !before.accepted => before.earnedScaled == 0;

    f(e, args);

    IAgreements.Agreement after = agreementOf(id);
    assert !after.accepted => after.earnedScaled == 0, "an offer earns nothing";
}

// ------------------------------------------------------------------ A10

/// A10: an end date only moves earlier, whatever is called.
rule A10_endOnlyEarlier(method f, env e, calldataarg args, uint256 id) filtered { f -> onAgreements(f) && !f.isView } {
    sceneWithoutReentry();
    IAgreements.Agreement before = agreementOf(id);
    require id <= agreementCount(); // an existing agreement (ids run from 1)

    f(e, args);

    IAgreements.Agreement after = agreementOf(id);
    assert before.endsAt != 0 => (after.endsAt != 0 && after.endsAt <= before.endsAt), "never later, never removed";
}

/// A10: an agreement with an end date never changes rate.
rule A10_noRateChangeWithAnEnd(env e, uint256 id, uint128 newRate, uint64 effectiveAt) {
    sceneWithoutReentry();
    IAgreements.Agreement before = agreementOf(id);
    require before.endsAt != 0;

    changeRate@withrevert(e, id, newRate, effectiveAt);

    assert lastReverted, "changeRate refuses an agreement with an end";
}

// ------------------------------------------------------------------ A11 (D10)

/// A11: while `collect` pays through Budgets, every state-changing Agreements call the payout makes back is
/// refused with ReentrantCall.
rule A11_lockRefusesReentry(env e, uint256 id, uint128 amount) {
    require budgets.agreements() == currentContract;
    require budgets.reenter();
    require !budgets.reentered();
    IAgreements.Agreement before = agreementOf(id);

    collect(e, id, amount);

    assert budgets.reentered(), "the payout called back";
    assert !budgets.reentrySucceeded(), "the inner call was refused";
    assert budgets.reentryError() == to_bytes4(0x37ed32e8), "with ReentrantCall";
}

// ------------------------------------------------------------------ the payee, H2, H5

/// Only the payee collects.
rule onlyPayeeCollects(env e, uint256 id, uint128 amount) {
    sceneWithoutReentry();
    IAgreements.Agreement before = agreementOf(id);

    collect@withrevert(e, id, amount);

    assert !lastReverted => e.msg.sender == before.payee, "only the payee";
}

/// H2: every guarded call on an agreement reverts for a caller `budgets.authorised` refuses for its budget.
rule H2_guarded(env e, uint8 which, uint256 id, uint128 rate, uint64 effectiveAt) {
    sceneWithoutReentry();
    IAgreements.Agreement before = agreementOf(id);
    bool auth = isAuthorised(e, before.budgetId);

    if (which == 0) {
        withdrawOffer@withrevert(e, id);
    } else if (which == 1) {
        changeRate@withrevert(e, id, rate, effectiveAt);
    } else if (which == 2) {
        cancelChange@withrevert(e, id);
    } else if (which == 3) {
        pause@withrevert(e, id);
    } else if (which == 4) {
        resume@withrevert(e, id);
    } else {
        end@withrevert(e, id, effectiveAt);
    }

    assert !auth => lastReverted, "unauthorised callers are refused";
}

/// H2 for `offer`: a caller `budgets.authorised` refuses for the named budget is refused.
rule H2_guardedOffer(
    env e,
    uint256 budgetId,
    address payee,
    uint128 rate,
    uint8 period,
    uint64 startsAt,
    uint64 endsAt,
    uint64 step,
    uint64 expiry,
    bytes32 doc
) {
    sceneWithoutReentry();
    uint256 count = agreementCount(); // vacuity read
    bool auth = isAuthorised(e, budgetId);

    offer@withrevert(e, budgetId, payee, rate, period, startsAt, endsAt, step, expiry, doc);

    assert !auth => lastReverted, "unauthorised callers are refused";
    assert !lastReverted => agreementCount() == count + 1, "ids run from 1, one per offer";
}

/// H5: no Agreements call reaches a Hats mutator.
rule H5_noHatsMutation(method f, env e, calldataarg args) filtered { f -> onAgreements(f) && !f.isView } {
    sceneWithoutReentry();
    uint256 count = agreementCount(); // vacuity read
    require !hatsHarness.mutated();

    f(e, args);

    assert !hatsHarness.mutated(), "Agreements never changes Hats";
}
