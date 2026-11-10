// Options rules (docs/planning/protocol-v4/fv/certora.md "Vesting.spec and Options.spec"; invariants O1, O2,
// H4, H5; ruling F9: exercise shrinks the pool).
//
// Summaries
// - Calendar.monthsBetween (the vesting step count) is a ghost: 0 when `to <= from`, monotone in `to`. That is
//   all O1 needs, and it is what the exhaustive Calendar loops prove (C3, C9).
// - The Captable's `issue` and `exits`, Payments' `send` and the strike token's `transferFrom`/`approve`/
//   `transfer` are NONDET: they never change Options' storage, and O1/O2/H4 do not depend on token balances.
//   The strike's exact amount and the issue are unit-, fuzz- and Halmos-tested (check_O1_exerciseUpToVested).
// - Hats mutators set a ghost flag (H5); Options never calls Hats.
// - O2 is stated per function rather than as one ghost sum over hooks: each state-changing call moves
//   `allocated` by exactly the change of the grant it touches (`live(id)`, OptionsHarness), and leaves every
//   other grant's `live` alone. From an empty contract (allocated 0, no grants) that is the sum by induction,
//   without hooks on the struct fields of a mapping and without a nonlinear vested-at-end term in a hook.

methods {
    function safe() external returns (address) envfree;
    function pool() external returns (uint128) envfree;
    function allocated() external returns (uint128) envfree;
    function live(uint256) external returns (uint256) envfree;
    function vestedOf(uint256, uint64) external returns (uint128) envfree;
    function getGrant(uint256) external returns (IOptions.OptionGrant) envfree;

    function Calendar.monthsBetween(uint256 from, uint256 to) internal returns (uint256) => monthsGhost(from, to);

    function _.issue(uint8, address, uint128, bytes32) external => NONDET;
    function _.exits() external => NONDET;
    function _.send(IPayments.PaymentItem) external => NONDET;
    function _.transferFrom(address, address, uint256) external => NONDET;
    function _.transfer(address, uint256) external => NONDET;
    function _.approve(address, uint256) external => NONDET;

    function _.mintHat(uint256, address) external => hatsMutated() expect bool;
    function _.transferHat(uint256, address, address) external => hatsMutatedVoid() expect void;
    function _.createHat(uint256, string, uint32, address, address, bool, string) external
        => hatsMutatedId() expect uint256;
    function _.changeHatEligibility(uint256, address) external => hatsMutatedVoid() expect void;
    function _.setHatWearerStatus(uint256, address, bool, bool) external => hatsMutated() expect bool;
}

ghost monthsGhost(uint256, uint256) returns uint256 {
    axiom forall uint256 a. forall uint256 b. b <= a => monthsGhost(a, b) == 0;
    axiom forall uint256 a. forall uint256 b. forall uint256 c. b <= c => monthsGhost(a, b) <= monthsGhost(a, c);
}

ghost bool hatsCalled;

function hatsMutated() returns bool {
    hatsCalled = true;
    return true;
}

function hatsMutatedVoid() {
    hatsCalled = true;
}

function hatsMutatedId() returns uint256 {
    hatsCalled = true;
    uint256 id;
    return id;
}

// ---------------------------------------------------------------------------------------------------------
// O1: exercised never exceeds vested
// ---------------------------------------------------------------------------------------------------------

/// O1 (vested as a monotone function of time): if a grant has exercised no more than vested now, then after
/// any call it has exercised no more than vested at any later time. fv/certora.md names an invariant; a rule is
/// used because the property needs time to move forward, which a CVL invariant cannot state.
rule O1_exercisedBounded(method f, env e, calldataarg args, uint256 id, uint64 later)
    filtered { f -> !f.isView }
{
    require e.block.timestamp <= max_uint64;
    require to_mathint(later) >= to_mathint(e.block.timestamp);
    require getGrant(id).exercised <= vestedOf(id, require_uint64(e.block.timestamp));

    f(e, args);

    assert getGrant(id).exercised <= vestedOf(id, later), "exercised beyond vested";
}

// ---------------------------------------------------------------------------------------------------------
// O2: allocated is the sum of the live grants and fits the pool
// ---------------------------------------------------------------------------------------------------------

/// O2: allocated never exceeds the pool.
invariant O2_allocatedWithinPool()
    allocated() <= pool();

/// O2, exercise: allocated falls by exactly the shares, so does the pool (F9), and so does the grant's live part.
rule O2_poolSums_exercise(env e, uint256 id, uint128 n, uint256 other) {
    require other != id;
    mathint a0 = allocated();
    mathint p0 = pool();
    mathint l0 = live(id);
    mathint o0 = live(other);

    exercise(e, id, n);

    assert to_mathint(allocated()) == a0 - n, "allocated";
    assert to_mathint(pool()) == p0 - n, "pool shrinks on exercise";
    assert to_mathint(live(id)) == l0 - n, "live";
    assert to_mathint(live(other)) == o0, "other grant";
}

/// O2, grant: allocated rises by exactly the new grant's shares; no other grant moves.
rule O2_poolSums_grant(env e, address grantee, uint128 shares, address token, uint128 strike, uint64 start,
    uint64 cliff, uint64 end, uint64 offerExpiresAt, uint64 expiresAt, uint32 windowDays, bytes32 doc,
    uint256 other) {
    mathint a0 = allocated();
    mathint o0 = live(other);

    uint256 id = grant(e, grantee, shares, token, strike, start, cliff, end, offerExpiresAt, expiresAt,
        windowDays, doc);

    assert to_mathint(allocated()) == a0 + shares, "allocated";
    assert to_mathint(live(id)) == to_mathint(shares), "new grant fully live";
    assert other != id => to_mathint(live(other)) == o0, "other grant";
}

/// O2, end and lapse: allocated falls by exactly the grant's live change; no other grant moves.
rule O2_poolSums_endOrLapse(env e, method f, uint256 id, uint64 endedAt, uint256 other)
    filtered { f -> f.selector == sig:end(uint256, uint64).selector || f.selector == sig:lapse(uint256).selector }
{
    require other != id;
    mathint a0 = allocated();
    mathint l0 = live(id);
    mathint o0 = live(other);
    mathint p0 = pool();

    if (f.selector == sig:end(uint256, uint64).selector) {
        end(e, id, endedAt);
    } else {
        lapse(e, id);
    }

    assert to_mathint(allocated()) - a0 == to_mathint(live(id)) - l0, "allocated tracks the grant";
    assert to_mathint(live(other)) == o0, "other grant";
    assert to_mathint(pool()) == p0, "pool unchanged";
}

/// O2, setPool and accept: allocated and every grant's live part unchanged.
rule O2_poolSums_noAllocation(env e, method f, calldataarg args, uint256 id)
    filtered {
        f -> f.selector == sig:setPool(uint128).selector || f.selector == sig:accept(uint256, bytes32).selector
    }
{
    mathint a0 = allocated();
    mathint l0 = live(id);

    f(e, args);

    assert to_mathint(allocated()) == a0, "allocated";
    assert to_mathint(live(id)) == l0, "live";
}

/// O2 and X2, endAllForExit: nothing stays allocated or live.
rule O2_poolSums_endAllForExit(env e, uint256 id) {
    endAllForExit(e);

    assert allocated() == 0, "allocated after exit";
    assert live(id) == 0, "a grant still live after exit";
}

// ---------------------------------------------------------------------------------------------------------
// H4 and H5
// ---------------------------------------------------------------------------------------------------------

/// H4: setPool, grant and end succeed only for the company Safe.
rule H4_boardOnly_Options(env e, method f, calldataarg args)
    filtered {
        f -> f.selector == sig:setPool(uint128).selector
            || f.selector == sig:grant(address, uint128, address, uint128, uint64, uint64, uint64, uint64, uint64,
                uint32, bytes32).selector
            || f.selector == sig:end(uint256, uint64).selector
    }
{
    f@withrevert(e, args);

    assert !lastReverted => e.msg.sender == safe(), "a Board function succeeded for someone else";
}

/// H5: no Options call mutates Hats.
rule H5_noHatsMutation(env e, method f, calldataarg args) filtered { f -> !f.isView } {
    require !hatsCalled;

    f(e, args);

    assert !hatsCalled, "Options mutated Hats";
}
