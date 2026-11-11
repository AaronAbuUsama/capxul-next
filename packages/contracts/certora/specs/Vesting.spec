// Vesting rules (docs/planning/protocol-v4/fv/certora.md "Vesting.spec and Options.spec"; invariants V4, V6,
// H4 and H5; rulings D4, D7, F7).
//
// Summaries
// - A grant's Captable is any contract: `safe()` and `exits()` are ghosts keyed by the Captable called, so two
//   reads in one transaction agree and the Board of one Captable is never the Board of another by accident.
// - `issue`, `burnUnvested`, `getClass` and the class token's `balanceOf` are NONDET: the Captable's own effects
//   are its spec's business (E1, D6); Vesting's rules here are about who may act and what Vesting stores.
// - `Calendar.monthsBetween` is a ghost, 0 when `to <= from` and monotone in `to`: the Calendar's exhaustive
//   Foundry loops prove both (fv/halmos.md, C-rows).
// - Every state-changing Hats function sets `hatsMutated` (H5). Vesting has no Hats reference at all.
// - V2 (`balanceCoversLock`) is optional in fv/certora.md and needs Captable, ShareClass and Vesting linked;
//   it stays a Foundry invariant (test/invariant/Vesting.invariant.t.sol, invariant_V2_balanceCoversLock).

methods {
    function getGrant(uint256) external returns (IVesting.Grant) envfree;
    function grantOf(address, uint8, address) external returns (uint256) envfree;

    function _.safe() external => safeOf(calledContract) expect address;
    function _.exits() external => exitsOf(calledContract) expect address;
    function _.issue(uint8, address, uint128, bytes32) external => NONDET;
    function _.burnUnvested(uint8, address, uint128) external => NONDET;
    function _.getClass(uint8) external => NONDET;
    function _.balanceOf(address) external => NONDET;

    function Calendar.monthsBetween(uint256 from, uint256 to) internal returns (uint256) => monthsGhost(from, to);

    function _.mintTopHat(address, string, string) external => hatsMutation() expect uint256;
    function _.createHat(uint256, string, uint32, address, address, bool, string) external
        => hatsMutation() expect uint256;
    function _.mintHat(uint256, address) external => hatsMutationBool() expect bool;
    function _.transferHat(uint256, address, address) external => hatsMutationVoid() expect void;
    function _.changeHatEligibility(uint256, address) external => hatsMutationVoid() expect void;
    function _.changeHatToggle(uint256, address) external => hatsMutationVoid() expect void;
    function _.changeHatMaxSupply(uint256, uint32) external => hatsMutationVoid() expect void;
    function _.checkHatWearerStatus(uint256, address) external => hatsMutationBool() expect bool;
}

ghost safeOf(address) returns address;
ghost exitsOf(address) returns address;

ghost monthsGhost(uint256, uint256) returns uint256 {
    axiom forall uint256 a. forall uint256 b. b <= a => monthsGhost(a, b) == 0;
    axiom forall uint256 a. forall uint256 b. forall uint256 c. b <= c => monthsGhost(a, b) <= monthsGhost(a, c);
}

ghost bool hatsMutated;

function hatsMutation() returns uint256 {
    hatsMutated = true;
    uint256 x;
    return x;
}

function hatsMutationBool() returns bool {
    hatsMutated = true;
    bool x;
    return x;
}

function hatsMutationVoid() {
    hatsMutated = true;
}

definition isGrantAndIssue(method f) returns bool =
    f.selector == sig:grantAndIssue(address, uint8, address, uint128, uint64, uint64, uint64, bool, bytes32).selector;

definition isAcceptGrant(method f) returns bool = f.selector == sig:acceptGrant(uint256, bytes32).selector;

/// V4 (D4, F7): an account gets a live grant on a class only from `grantAndIssue` (which issues the shares in
/// the same call) or from its own `acceptGrant`. No other call, and nobody else, makes a grant live.
rule V4_grantNeedsAcceptance(env e, method f, calldataarg args) filtered { f -> !f.isView } {
    address c;
    uint8 k;
    address a;
    require grantOf(c, k, a) == 0;

    f(e, args);

    assert grantOf(c, k, a) != 0 => (isGrantAndIssue(f) || (isAcceptGrant(f) && e.msg.sender == a)),
        "a grant went live without its issue or the shareholder's acceptance";
}

/// V4: an offer is stored not accepted and makes nothing live; the shareholder's live grant is unchanged.
rule V4_offerLocksNothing(
    env e, address c, uint8 k, address a, uint128 amount, uint64 s, uint64 cl, uint64 en, uint64 exp, bool x, bytes32 d
) {
    uint256 liveBefore = grantOf(c, k, a);

    uint256 id = offerGrant(e, c, k, a, amount, s, cl, en, exp, x, d);

    assert !getGrant(id).accepted, "an offer was stored accepted";
    assert grantOf(c, k, a) == liveBefore, "an offer changed the live grant";
}

/// V4: only the grant's shareholder turns `accepted` from false to true, by `acceptGrant`.
rule V4_onlyShareholderAccepts(env e, method f, calldataarg args, uint256 id) filtered { f -> !f.isView } {
    IVesting.Grant before = getGrant(id);
    require !before.accepted;

    f(e, args);

    IVesting.Grant after = getGrant(id);
    assert after.accepted => (isAcceptGrant(f) && e.msg.sender == before.shareholder),
        "an offer was accepted by someone else";
}

/// V6 (D7): a successful `accelerate` asked for an earlier end with a document, and stored an end no later and a
/// cliff no later than before, the document, and the same shares, shareholder and start.
rule V6_accelerateOnlyEarlier(env e, uint256 id, uint64 newEnd, bytes32 doc) {
    IVesting.Grant before = getGrant(id);

    accelerate(e, id, newEnd, doc);

    IVesting.Grant after = getGrant(id);
    assert newEnd < before.end, "accelerated to a later end";
    assert doc != to_bytes32(0), "accelerated without a document";
    assert after.end <= before.end && after.end >= before.start, "end moved later or before the start";
    assert after.cliff <= after.end, "cliff past the end";
    // D7: the cliff never moves later, except that a new schedule under one whole month collapses it onto the
    // end (all at once), which can be after a cliff that was the start. Only that case may move it later.
    assert after.cliff <= before.cliff
        || (after.cliff == after.end && monthsGhost(before.start, after.end) == 0), "cliff moved later";
    assert monthsGhost(before.start, after.end) == 0 => after.cliff == after.end, "under one month, not all at once";
    assert after.documentHash == doc, "document not stored";
    assert after.amount == before.amount && after.shareholder == before.shareholder && after.start == before.start,
        "accelerate changed the grant's shares";
}

/// V6: no call moves an existing grant's end later.
rule V6_endNeverGrows(env e, method f, calldataarg args, uint256 id) filtered { f -> !f.isView } {
    IVesting.Grant before = getGrant(id);
    require before.captable != 0;

    f(e, args);

    assert getGrant(id).end <= before.end, "a grant's end grew";
}

/// H4: the Board functions succeed only for the Captable's Safe.
rule H4_boardOnly_Vesting_grantAndIssue(
    env e, address c, uint8 k, address a, uint128 amount, uint64 s, uint64 cl, uint64 en, bool x, bytes32 d
) {
    grantAndIssue(e, c, k, a, amount, s, cl, en, x, d);
    assert e.msg.sender == safeOf(c), "grantAndIssue by someone other than the Safe";
}

rule H4_boardOnly_Vesting_offerGrant(
    env e, address c, uint8 k, address a, uint128 amount, uint64 s, uint64 cl, uint64 en, uint64 exp, bool x, bytes32 d
) {
    offerGrant(e, c, k, a, amount, s, cl, en, exp, x, d);
    assert e.msg.sender == safeOf(c), "offerGrant by someone other than the Safe";
}

rule H4_boardOnly_Vesting_revoke(env e, uint256 id, uint64 effectiveAt) {
    address c = getGrant(id).captable;
    revoke(e, id, effectiveAt);
    assert e.msg.sender == safeOf(c), "revoke by someone other than the Safe";
    assert effectiveAt >= e.block.timestamp, "V3: revoked in the past";
}

rule H4_boardOnly_Vesting_accelerate(env e, uint256 id, uint64 newEnd, bytes32 doc) {
    address c = getGrant(id).captable;
    accelerate(e, id, newEnd, doc);
    assert e.msg.sender == safeOf(c), "accelerate by someone other than the Safe";
}

/// H4 (the one named module): `accelerateForExit` succeeds only for the Captable's Exits.
rule H4_exitsOnly_Vesting_accelerateForExit(env e, uint256 id) {
    address c = getGrant(id).captable;
    accelerateForExit(e, id);
    assert e.msg.sender == exitsOf(c), "accelerateForExit by someone other than Exits";
}

/// H5: no Vesting function calls a state-changing Hats function.
rule H5_noHatsMutation_Vesting(env e, method f, calldataarg args) filtered { f -> !f.isView } {
    require !hatsMutated;
    f(e, args);
    assert !hatsMutated, "Vesting changed Hats state";
}
