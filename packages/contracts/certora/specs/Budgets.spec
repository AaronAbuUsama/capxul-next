// SPDX-License-Identifier: GPL-3.0-or-later
//
// Budgets rules (docs/planning/protocol-v4/fv/certora.md "Budgets.spec"; invariants B1-B4, B6, B7, B9,
// B12-B15, H1-H6 and onlyAgreementsCommits). B16 is certora/specs/BudgetsReentry.spec (its own conf, with the
// callback harness linked instead of the payout summary). B5, B8, B10 are fork tests; B11 follows from the
// effective form of B1/B2 and is a Foundry invariant.
//
// Summaries
// - Hats: ghost-backed `wears`/`good`, so two reads in one transaction agree (H1's "iff"). Every Hats mutator
//   sets `hatsMutated` (H5).
// - Roles: `execTransactionWithRole` => payoutCall(): revert, or succeed and change no Budgets storage. Sound
//   because D10's lock makes re-entry revert (B16 proves it) and Budgets reads no external state after the
//   payout. `payoutOk` lets a rule assume the payout goes through (B9).
// - Payments: `paymentId` => a fresh id. Calendar: `periodIndex` as a monotone ghost (CalendarSummaries.spec).
// - configure's reads (`avatar`, `target`, the Gate's `safe`) are NONDET views.
//
// Effective values (R4 3.3). Spend belongs to a period; reservations and amounts do not. `nowG` follows
// block.timestamp through a TIMESTAMP hook (time never moves back), and eff(x) is x only while the budget's
// stored periodIndex is the current one.
//
// Vacuity (verification-loop.md, K7): every rule calls Budgets without @withrevert at least once on its main
// path, or reads harness state whose function reverts on the stub, so `--rule_sanity basic` flags every rule
// on the stub commit.
//
// Written, not yet run: the first W2 gate-11 run confirms the TIMESTAMP hook, the CVL revert in payoutCall()
// and the struct-field hooks on this Prover build (fv/certora.md asks the same of the payout summary).

import "CalendarSummaries.spec";

methods {
    // Harness reads (raw storage).
    function parentOf(uint256) external returns (uint256) envfree;
    function safeOf(uint256) external returns (address) envfree;
    function hatOf(uint256) external returns (uint256) envfree;
    function tokenOf(uint256) external returns (address) envfree;
    function periodOf(uint256) external returns (uint8) envfree;
    function depthOf(uint256) external returns (uint8) envfree;
    function closedOf(uint256) external returns (bool) envfree;
    function amountOf(uint256) external returns (uint128) envfree;
    function childrenAmountOf(uint256) external returns (uint128) envfree;
    function ownSpentRaw(uint256) external returns (uint128) envfree;
    function spentRaw(uint256) external returns (uint128) envfree;
    function ownCommittedOf(uint256) external returns (uint128) envfree;
    function committedOf(uint256) external returns (uint128) envfree;
    function periodIndexOf(uint256) external returns (uint64) envfree;
    function scheduledStateOf(uint256) external returns (uint8) envfree;
    function scheduledBudgetOf(uint256) external returns (uint256) envfree;
    function scheduledAmountOf(uint256) external returns (uint128) envfree;
    function scheduledPayAtOf(uint256) external returns (uint64) envfree;
    function rolesOf(address) external returns (address) envfree;
    function roleKeyOf(address) external returns (bytes32) envfree;
    function isEntered() external returns (bool) envfree;
    function agreements() external returns (address) envfree;
    function authorised(uint256, address) external returns (bool) envfree;

    // Hats reads and mutators.
    function _.isWearerOfHat(address w, uint256 h) external => wearsCVL(w, h) expect bool;
    function _.isInGoodStanding(address w, uint256 h) external => goodCVL(w, h) expect bool;
    function _.mintHat(uint256, address) external => hatsMutatedBool() expect bool;
    function _.mintTopHat(address, string, string) external => hatsMutatedUint() expect uint256;
    function _.createHat(uint256, string, uint32, address, address, bool, string) external
        => hatsMutatedUint() expect uint256;
    function _.transferHat(uint256, address, address) external => hatsMutatedVoid() expect void;
    function _.changeHatEligibility(uint256, address) external => hatsMutatedVoid() expect void;
    function _.changeHatToggle(uint256, address) external => hatsMutatedVoid() expect void;
    function _.changeHatMaxSupply(uint256, uint32) external => hatsMutatedVoid() expect void;
    function _.checkHatWearerStatus(uint256, address) external => hatsMutatedBool() expect bool;

    // The payout and its id.
    function _.execTransactionWithRole(address, uint256, bytes, uint8, bytes32, bool) external
        => payoutCall() expect bool;
    function _.paymentId(IPayments.PaymentItem) external => freshId() expect bytes32;

    // configure's reads.
    function _.avatar() external => NONDET;
    function _.target() external => NONDET;
    function _.safe() external => NONDET;
}

// ------------------------------------------------------------------ summaries

ghost mapping(address => mapping(uint256 => bool)) wears;
ghost mapping(address => mapping(uint256 => bool)) good;
ghost bool hatsMutated;
ghost bool payoutOk;
ghost mathint payouts;

function wearsCVL(address w, uint256 h) returns bool { return wears[w][h]; }
function goodCVL(address w, uint256 h) returns bool { return good[w][h]; }
function hatsMutatedBool() returns bool { hatsMutated = true; bool b; return b; }
function hatsMutatedUint() returns uint256 { hatsMutated = true; uint256 u; return u; }
function hatsMutatedVoid() { hatsMutated = true; }

function payoutCall() returns bool {
    bool ok;
    if (!ok && !payoutOk) {
        revert("payout refused");
    }
    payouts = payouts + 1;
    return true;
}

function freshId() returns bytes32 { bytes32 id; return id; }

definition wearsGood(address w, uint256 h) returns bool = wears[w][h] && good[w][h];

// ------------------------------------------------------------------ time and effective values

ghost uint256 nowG;

hook TIMESTAMP uint256 t {
    require t >= nowG;
    nowG = t;
}

definition current(uint256 id) returns bool =
    to_mathint(periodIndexOf(id)) == to_mathint(periodIndexGhost(periodOf(id), nowG));

definition effOwnSpent(uint256 id) returns mathint = current(id) ? to_mathint(ownSpentRaw(id)) : 0;

definition effSpent(uint256 id) returns mathint = current(id) ? to_mathint(spentRaw(id)) : 0;

// ------------------------------------------------------------------ ghost sums over parentOf

ghost mapping(uint256 => uint256) parentG {
    init_state axiom forall uint256 i. parentG[i] == 0;
}
ghost mapping(uint256 => mathint) amountG {
    init_state axiom forall uint256 i. amountG[i] == 0;
}
ghost mapping(uint256 => mathint) committedG {
    init_state axiom forall uint256 i. committedG[i] == 0;
}
ghost mapping(uint256 => mathint) spentG {
    init_state axiom forall uint256 i. spentG[i] == 0;
}
ghost mapping(uint256 => uint64) indexG {
    init_state axiom forall uint256 i. indexG[i] == 0;
}
ghost mapping(uint256 => mathint) sumChildrenAmount {
    init_state axiom forall uint256 i. sumChildrenAmount[i] == 0;
}
ghost mapping(uint256 => mathint) sumChildrenCommitted {
    init_state axiom forall uint256 i. sumChildrenCommitted[i] == 0;
}
/// The children's stored `spent`, bucketed by each child's stored periodIndex (B2's effective form).
ghost mapping(uint256 => mapping(uint64 => mathint)) sumChildrenSpentAt {
    init_state axiom forall uint256 i. forall uint64 p. sumChildrenSpentAt[i][p] == 0;
}
ghost mapping(uint256 => mathint) sumPendingScheduled {
    init_state axiom forall uint256 i. sumPendingScheduled[i] == 0;
}
ghost mapping(uint256 => uint8) stateG {
    init_state axiom forall uint256 s. stateG[s] == 0;
}

hook Sload uint256 p _budgets[KEY uint256 id].parent {
    require parentG[id] == p;
}

/// A budget's parent is written once, at creation; whatever was already stored moves with it.
hook Sstore _budgets[KEY uint256 id].parent uint256 p (uint256 previous) {
    sumChildrenAmount[previous] = sumChildrenAmount[previous] - amountG[id];
    sumChildrenAmount[p] = sumChildrenAmount[p] + amountG[id];
    sumChildrenCommitted[previous] = sumChildrenCommitted[previous] - committedG[id];
    sumChildrenCommitted[p] = sumChildrenCommitted[p] + committedG[id];
    sumChildrenSpentAt[previous][indexG[id]] = sumChildrenSpentAt[previous][indexG[id]] - spentG[id];
    sumChildrenSpentAt[p][indexG[id]] = sumChildrenSpentAt[p][indexG[id]] + spentG[id];
    parentG[id] = p;
}

hook Sstore _budgets[KEY uint256 id].amount uint128 v (uint128 previous) {
    sumChildrenAmount[parentG[id]] = sumChildrenAmount[parentG[id]] + v - previous;
    amountG[id] = v;
}

hook Sstore _budgets[KEY uint256 id].committed uint128 v (uint128 previous) {
    sumChildrenCommitted[parentG[id]] = sumChildrenCommitted[parentG[id]] + v - previous;
    committedG[id] = v;
}

hook Sstore _budgets[KEY uint256 id].spent uint128 v (uint128 previous) {
    sumChildrenSpentAt[parentG[id]][indexG[id]] = sumChildrenSpentAt[parentG[id]][indexG[id]] + v - previous;
    spentG[id] = v;
}

hook Sstore _budgets[KEY uint256 id].periodIndex uint64 v (uint64 previous) {
    sumChildrenSpentAt[parentG[id]][previous] = sumChildrenSpentAt[parentG[id]][previous] - spentG[id];
    sumChildrenSpentAt[parentG[id]][v] = sumChildrenSpentAt[parentG[id]][v] + spentG[id];
    indexG[id] = v;
}

/// A scheduled payment's budget and amount are stored before its state (struct order), and never change.
hook Sstore _scheduled[KEY uint256 s].state IBudgets.ScheduleState v (IBudgets.ScheduleState previous) {
    uint256 b = currentContract._scheduled[s].budgetId;
    mathint amt = to_mathint(currentContract._scheduled[s].amount);
    if (previous == IBudgets.ScheduleState.Pending) {
        sumPendingScheduled[b] = sumPendingScheduled[b] - amt;
    }
    if (v == IBudgets.ScheduleState.Pending) {
        sumPendingScheduled[b] = sumPendingScheduled[b] + amt;
    }
    stateG[s] = assert_uint8(v);
}

// ------------------------------------------------------------------ helpers

definition PENDING() returns uint8 = 1;
definition CANCELLED() returns uint8 = 2;
definition PAID() returns uint8 = 3;

/// The budget or one of its first eight ancestors is closed (MAX_DEPTH = 8).
definition closedPath(uint256 id) returns bool =
    closedOf(id)
    || (parentOf(id) != 0 && closedOf(parentOf(id)))
    || (parentOf(parentOf(id)) != 0 && closedOf(parentOf(parentOf(id))))
    || (parentOf(parentOf(parentOf(id))) != 0 && closedOf(parentOf(parentOf(parentOf(id)))));

/// H1's right-hand side, unrolled over the eight levels a path can have.
function onPath(address who, uint256 id) returns bool {
    uint256 b1 = id;
    uint256 b2 = parentOf(b1);
    uint256 b3 = parentOf(b2);
    uint256 b4 = parentOf(b3);
    uint256 b5 = parentOf(b4);
    uint256 b6 = parentOf(b5);
    uint256 b7 = parentOf(b6);
    uint256 b8 = parentOf(b7);
    return (b1 != 0 && wearsGood(who, hatOf(b1))) || (b2 != 0 && wearsGood(who, hatOf(b2)))
        || (b3 != 0 && wearsGood(who, hatOf(b3))) || (b4 != 0 && wearsGood(who, hatOf(b4)))
        || (b5 != 0 && wearsGood(who, hatOf(b5))) || (b6 != 0 && wearsGood(who, hatOf(b6)))
        || (b7 != 0 && wearsGood(who, hatOf(b7))) || (b8 != 0 && wearsGood(who, hatOf(b8)));
}

// ------------------------------------------------------------------ B1 B2 B4 B6 B15 (invariants)

/// B1 over effective values; the reservation half holds whatever the period.
invariant B1_useFits(uint256 id)
    effOwnSpent(id) + ownCommittedOf(id) + childrenAmountOf(id) <= to_mathint(amountOf(id))
    {
        preserved {
            requireInvariant B6_childrenFit(id);
            requireInvariant B6_childrenFit(parentOf(id));
        }
    }

/// B2: committed is own plus the children's; spent is own plus the children's spent in the same period.
invariant B2_sumsMatch(uint256 id)
    to_mathint(committedOf(id)) == ownCommittedOf(id) + sumChildrenCommitted[id]
    && to_mathint(spentRaw(id)) == ownSpentRaw(id) + sumChildrenSpentAt[id][periodIndexOf(id)]
    {
        preserved {
            requireInvariant B4_inherit(id);
        }
    }

/// B4: a child has its parent's token and period, and sits one level below it.
invariant B4_inherit(uint256 id)
    parentOf(id) != 0 => (
        tokenOf(id) == tokenOf(parentOf(id)) && periodOf(id) == periodOf(parentOf(id))
        && to_mathint(depthOf(id)) == depthOf(parentOf(id)) + 1 && safeOf(id) == safeOf(parentOf(id))
    );

/// B6: childrenAmount is the sum of the children's amounts and fits the budget.
invariant B6_childrenFit(uint256 id)
    to_mathint(childrenAmountOf(id)) == sumChildrenAmount[id] && childrenAmountOf(id) <= amountOf(id);

/// B15, the scheduled part: pending scheduled amounts are always inside ownCommitted. (The agreement part
/// is A2.) Agreements releases only its own part.
invariant B15_scheduledReserved(uint256 id)
    sumPendingScheduled[id] <= to_mathint(ownCommittedOf(id))
    {
        preserved release(uint256 rid, uint128 amt) with (env e) {
            require to_mathint(amt) <= ownCommittedOf(rid) - sumPendingScheduled[rid];
        }
    }

// ------------------------------------------------------------------ B3 B9 B12 B13 B14

/// B3: nothing spends, commits, schedules or creates a child under a closed path.
rule B3_closedBlocks(env e, method f, uint256 id, address to, uint128 amount, uint16 kind, uint64 payAt,
    bytes32 doc, bytes32 job, uint256 hat)
    filtered { f -> f.selector == sig:spend(uint256,address,uint128,uint16,bytes32,bytes32).selector
        || f.selector == sig:commit(uint256,uint128).selector
        || f.selector == sig:schedule(uint256,address,uint128,uint16,uint64,bytes32).selector
        || f.selector == sig:createChildBudget(uint256,uint128,uint256).selector }
{
    require closedPath(id);
    if (f.selector == sig:spend(uint256,address,uint128,uint16,bytes32,bytes32).selector) {
        spend@withrevert(e, id, to, amount, kind, doc, job);
    } else if (f.selector == sig:commit(uint256,uint128).selector) {
        commit@withrevert(e, id, amount);
    } else if (f.selector == sig:schedule(uint256,address,uint128,uint16,uint64,bytes32).selector) {
        schedule@withrevert(e, id, to, amount, kind, payAt, doc);
    } else {
        createChildBudget@withrevert(e, id, amount, hat);
    }
    assert lastReverted;
    // Not vacuous: the budget is readable.
    assert closedOf(id) || parentOf(id) != 0;
}

/// B9: a closed budget still pays what it reserved, through payReserved.
rule B9_closedStillPays(env e, uint256 id, address to, uint128 amount, bytes32 doc, bytes32 job) {
    require closedOf(id);
    require safeOf(id) != 0;
    require e.msg.sender == agreements();
    require e.msg.value == 0;
    require !isEntered();
    require payoutOk;
    payReserved@withrevert(e, id, to, amount, doc, job);
    assert !lastReverted;
}

/// B9: and a due scheduled payment on a closed budget executes.
rule B9_closedStillExecutes(env e, uint256 sid) {
    uint256 id = scheduledBudgetOf(sid);
    requireInvariant B15_scheduledReserved(id);
    requireInvariant B2_sumsMatch(id);
    requireInvariant B1_useFits(id);
    require closedOf(id);
    require scheduledStateOf(sid) == PENDING();
    require to_mathint(e.block.timestamp) >= to_mathint(scheduledPayAtOf(sid));
    require e.msg.value == 0;
    require !isEntered();
    require payoutOk;
    execute@withrevert(e, sid);
    assert !lastReverted;
}

/// B12 (D8): setAmount never leaves a budget below what it uses.
rule B12_noCutBelowUse(env e, uint256 id, uint128 a) {
    setAmount(e, id, a);
    assert to_mathint(a) >= effOwnSpent(id) + ownCommittedOf(id) + childrenAmountOf(id);
    assert amountOf(id) == a;
}

/// B13: Paid and Cancelled are final.
rule B13_scheduledPaidOnce(env e, method f, calldataarg args, uint256 sid) {
    uint8 before = scheduledStateOf(sid);
    require before == PAID() || before == CANCELLED();
    f(e, args);
    assert scheduledStateOf(sid) == before;
}

/// B13: execute on a payment that is not Pending reverts.
rule B13_executeNeedsPending(env e, uint256 sid) {
    bool pending = scheduledStateOf(sid) == PENDING();
    execute@withrevert(e, sid);
    assert !lastReverted => pending;
    assert !lastReverted => scheduledStateOf(sid) == PAID();
}

/// B14: never paid before payAt.
rule B14_notBeforePayAt(env e, uint256 sid) {
    uint64 payAt = scheduledPayAtOf(sid);
    execute(e, sid);
    assert to_mathint(e.block.timestamp) >= to_mathint(payAt);
}

/// B14 (F1): a pending payment cancels at any time, before or after payAt, for an authorised caller.
rule B14_cancelUntilPaid(env e, uint256 sid) {
    uint256 id = scheduledBudgetOf(sid);
    requireInvariant B15_scheduledReserved(id);
    requireInvariant B2_sumsMatch(id);
    require scheduledStateOf(sid) == PENDING();
    require authorised(id, e.msg.sender);
    require e.msg.value == 0;
    require !isEntered();
    cancel@withrevert(e, sid);
    assert !lastReverted;
    assert scheduledStateOf(sid) == CANCELLED();
}

// ------------------------------------------------------------------ B7

/// B7: a call by anyone who is not Safe B, wears no hat on B's budget's path and is not Agreements never
/// changes B's budget. (`execute` is open to anyone by design: M4.)
rule B7_otherSafeUntouched(env e, method f, calldataarg args, uint256 idB)
    filtered { f -> f.selector != sig:execute(uint256).selector && !f.isView }
{
    address safeB = safeOf(idB);
    require safeB != 0;
    require e.msg.sender != safeB;
    require e.msg.sender != agreements();
    require !onPath(e.msg.sender, idB);
    uint128 amountBefore = amountOf(idB);
    uint128 ownSpentBefore = ownSpentRaw(idB);
    uint128 ownCommittedBefore = ownCommittedOf(idB);
    bool closedBefore = closedOf(idB);
    uint256 hatBefore = hatOf(idB);
    address rolesBefore = rolesOf(safeB);

    f(e, args);

    assert amountOf(idB) == amountBefore;
    assert ownSpentRaw(idB) == ownSpentBefore || !current(idB);
    assert ownCommittedOf(idB) == ownCommittedBefore;
    assert closedOf(idB) == closedBefore;
    assert hatOf(idB) == hatBefore;
    assert rolesOf(safeB) == rolesBefore;
}

// ------------------------------------------------------------------ Agreements only

rule onlyAgreementsCommits(env e, method f, uint256 id, uint128 amount, address to, bytes32 doc, bytes32 job)
    filtered { f -> f.selector == sig:commit(uint256,uint128).selector
        || f.selector == sig:release(uint256,uint128).selector
        || f.selector == sig:payReserved(uint256,address,uint128,bytes32,bytes32).selector }
{
    address a = agreements();
    if (f.selector == sig:commit(uint256,uint128).selector) {
        commit@withrevert(e, id, amount);
    } else if (f.selector == sig:release(uint256,uint128).selector) {
        release@withrevert(e, id, amount);
    } else {
        payReserved@withrevert(e, id, to, amount, doc, job);
    }
    assert !lastReverted => e.msg.sender == a;
}

// ------------------------------------------------------------------ H1-H6

/// H1: authorised iff the Safe, or a wearer in good standing of a hat on the path.
rule H1_authorisedIff(uint256 id, address who) {
    requireInvariant B4_inherit(id);
    require depthOf(id) <= 8;
    bool result = authorised(id, who);
    assert result <=> (safeOf(id) != 0 && (who == safeOf(id) || onPath(who, id)));
}

/// H2: the hat-guarded functions succeed only for an authorised caller (checked before the call).
rule H2_guarded(env e, method f, uint256 id, address to, uint128 amount, uint16 kind, uint64 payAt,
    bytes32 doc, bytes32 job, uint256 hat)
    filtered { f -> f.selector == sig:spend(uint256,address,uint128,uint16,bytes32,bytes32).selector
        || f.selector == sig:schedule(uint256,address,uint128,uint16,uint64,bytes32).selector
        || f.selector == sig:createChildBudget(uint256,uint128,uint256).selector }
{
    bool allowed = authorised(id, e.msg.sender);
    if (f.selector == sig:spend(uint256,address,uint128,uint16,bytes32,bytes32).selector) {
        spend@withrevert(e, id, to, amount, kind, doc, job);
    } else if (f.selector == sig:schedule(uint256,address,uint128,uint16,uint64,bytes32).selector) {
        schedule@withrevert(e, id, to, amount, kind, payAt, doc);
    } else {
        createChildBudget@withrevert(e, id, amount, hat);
    }
    assert !lastReverted => allowed;
}

/// H2: cancel needs authority over the payment's budget.
rule H2_guardedCancel(env e, uint256 sid) {
    bool allowed = authorised(scheduledBudgetOf(sid), e.msg.sender);
    cancel@withrevert(e, sid);
    assert !lastReverted => allowed;
}

/// H3: no self-raise. setAmount, setHat, close, reopen: a child needs authority over its parent, a top
/// budget needs the Safe.
rule H3_noSelfRaise(env e, method f, uint256 id, uint128 amount, uint256 hat)
    filtered { f -> f.selector == sig:setAmount(uint256,uint128).selector
        || f.selector == sig:setHat(uint256,uint256).selector
        || f.selector == sig:close(uint256).selector
        || f.selector == sig:reopen(uint256).selector }
{
    uint256 parent = parentOf(id);
    bool allowed = parent == 0 ? e.msg.sender == safeOf(id) : authorised(parent, e.msg.sender);
    if (f.selector == sig:setAmount(uint256,uint128).selector) {
        setAmount@withrevert(e, id, amount);
    } else if (f.selector == sig:setHat(uint256,uint256).selector) {
        setHat@withrevert(e, id, hat);
    } else if (f.selector == sig:close(uint256).selector) {
        close@withrevert(e, id);
    } else {
        reopen@withrevert(e, id);
    }
    assert !lastReverted => allowed;
}

/// H4: createTopBudget is the configured Safe's alone; configure writes only the caller's own config.
rule H4_boardOnly_Budgets(env e, address token, uint8 period, uint128 amount, uint256 hat, address other) {
    require other != e.msg.sender;
    address otherRoles = rolesOf(other);
    address callerRoles = rolesOf(e.msg.sender);
    uint256 id = createTopBudget(e, token, period, amount, hat);
    assert callerRoles != 0;
    assert safeOf(id) == e.msg.sender;
    assert rolesOf(other) == otherRoles;
}

rule H4_configureOwnOnly(env e, address roles, bytes32 key, address other) {
    require other != e.msg.sender;
    address otherRoles = rolesOf(other);
    configure(e, roles, key);
    assert rolesOf(e.msg.sender) == roles && roleKeyOf(e.msg.sender) == key;
    assert rolesOf(other) == otherRoles;
}

/// H5: Budgets never calls a state-changing Hats function.
rule H5_noHatsMutation(env e, method f, calldataarg args) filtered { f -> !f.isView } {
    require !hatsMutated;
    f(e, args);
    assert !hatsMutated;
}

/// H6: losing the hat revokes authority at once; Budgets caches nothing.
rule H6_revocationImmediate(env e1, env e2, uint256 id, address to, uint128 a1, uint128 a2, bytes32 doc,
    bytes32 j1, bytes32 j2)
{
    require e1.msg.sender == e2.msg.sender;
    require e1.msg.sender != safeOf(id);
    spend(e1, id, to, a1, 0, doc, j1);
    // Every hat the caller wore is lost between the two calls.
    havoc wears assuming forall uint256 h. !wears@new[e1.msg.sender][h];
    spend@withrevert(e2, id, to, a2, 0, doc, j2);
    assert lastReverted;
}
