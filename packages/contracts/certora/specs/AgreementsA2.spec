// SPDX-License-Identifier: GPL-3.0-or-later
//
// A2, bounded (docs/planning/protocol-v4/fv/certora.md "Agreements.spec": real Budgets linked, settle loop at
// loop_iter 3 with optimistic_loop; invariants.md labels it "Certora (bounded)"; the Foundry invariant
// `invariant_A2_committedIsTheOpenReservations` at 64 open is primary).
//
// The form is a preservation rule over one budget with at most three agreements in its open list: every
// Agreements call changes the budget's `ownCommitted` by exactly the change in the sum of the current
// reservations of its open, not-closed agreements (due but unsettled ones included). `ownCommitted` also
// holds scheduled payments; Agreements never touches them, so the difference is what must be preserved.
//
// Summaries: Budgets' payout through Roles is `payoutCall()` (revert, or succeed and change no storage of the
// caller), per fv/certora.md "Payout calls and D10"; Calendar as CalendarSummaries.spec.
//
// Vacuity: the rule reads `openOf(b)` and `agreementOf` without `@withrevert` first; on the stub they revert.

import "CalendarSummaries.spec";

using Budgets as budgets;

methods {
    function agreementOf(uint256) external returns (IAgreements.Agreement) envfree;
    function openOf(uint256) external returns (uint256[]) envfree;
    function budgets.budgetOf(uint256) external returns (IBudgets.Budget);

    function _.execTransactionWithRole(address, uint256, bytes, uint8, bytes32, bool) external => payoutCall() expect bool;
    function _.isWearerOfHat(address, uint256) external => NONDET;
    function _.isInGoodStanding(address, uint256) external => NONDET;
}

function payoutCall() returns bool {
    bool ok;
    if (!ok) {
        revert("payout refused");
    }
    return true;
}

/// The sum of `reserved` over the not-closed agreements in `b`'s open list (at most three).
function openReserved(uint256 b) returns mathint {
    uint256[] open = openOf(b);
    require open.length <= 3;
    mathint first = 0;
    mathint second = 0;
    mathint third = 0;
    if (open.length > 0 && !agreementOf(open[0]).closed) { first = agreementOf(open[0]).reserved; }
    if (open.length > 1 && !agreementOf(open[1]).closed) { second = agreementOf(open[1]).reserved; }
    if (open.length > 2 && !agreementOf(open[2]).closed) { third = agreementOf(open[2]).reserved; }
    return first + second + third;
}

rule A2_reservationLifecycle(method f, env e, calldataarg args, uint256 b) filtered {
    f -> f.contract == currentContract && !f.isView
} {
    require e.msg.sender != budgets;
    mathint reservedBefore = openReserved(b);
    mathint committedBefore = budgets.budgetOf(e, b).ownCommitted;

    f(e, args);

    mathint reservedAfter = openReserved(b);
    mathint committedAfter = budgets.budgetOf(e, b).ownCommitted;
    assert committedAfter - reservedAfter == committedBefore - reservedBefore,
        "ownCommitted moves exactly with the open agreements' reservations";
}
