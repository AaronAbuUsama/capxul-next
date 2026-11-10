// Captable rules (docs/planning/protocol-v4/fv/certora.md, "Captable.spec and ShareClass.spec"; invariants E1,
// E2, E4, E7, E8, E10, E11, H4, H5). E3 (the sum over 32 classes) is not proved here (R4 3.7): Halmos proves
// the per-class formula and the Foundry invariant checks the sum. E6 is in ShareClass.spec (the token half).
//
// Summaries
// - Every class token is a clone (CREATE gives a fresh address), so its calls are summarised against ghosts
//   keyed by the token address: supply, balances, votes, past supply and the Safe's past balance. `mint`,
//   `burn` and `forcedMove` update them exactly as the ShareClass spec says (spec/share-class.md). Token-level
//   E8 (the Safe never votes) is ShareClass.spec's rule E8, assumed here as a requirement on the ghosts.
// - Vesting `lockedOf` is a ghost per (class, account). Governor `pendingUntil` is a ghost per Governor.
// - A custom transfer rule is NONDET. Hats is never called; its mutators set `hatsMutated` (H5).

methods {
    function safe() external returns (address) envfree;
    function governor() external returns (address) envfree;
    function vesting() external returns (address) envfree;
    function options() external returns (address) envfree;
    function rounds() external returns (address) envfree;
    function exits() external returns (address) envfree;
    function numberOfClasses() external returns (uint8) envfree;
    function issuerAllowance(address, uint8) external returns (uint128) envfree;
    function transferConsent(bytes32) external returns (bool) envfree;
    function convertibleReserved(uint8) external returns (uint256) envfree;
    function closedForExit() external returns (bool) envfree;
    function tokenOf(uint8) external returns (address) envfree;
    function authorisedOf(uint8) external returns (uint128) envfree;
    function weightOf(uint8) external returns (uint16) envfree;
    function convertsIntoOf(uint8) external returns (uint8) envfree;
    function originalIssuePriceOf(uint8) external returns (uint128) envfree;
    function floorOf(uint8) external returns (uint128) envfree;
    function classGovernorOf(uint8) external returns (address) envfree;
    function consentIdOf(uint8, address, address, uint128, bytes32) external returns (bytes32) envfree;

    // ShareClass (every clone), against ghosts.
    function _.totalSupply() external => supplyCVL(calledContract) expect uint256;
    function _.balanceOf(address a) external => balanceCVL(calledContract, a) expect uint256;
    function _.getVotes(address a) external => votesCVL(calledContract, a) expect uint256;
    function _.getPastVotes(address a, uint256 t) external => votesCVL(calledContract, a) expect uint256;
    function _.getPastTotalSupply(uint256 t) external => pastSupplyCVL(calledContract, t) expect uint256;
    function _.safeBalanceAt(uint256 t) external => safePastCVL(calledContract, t) expect uint256;
    function _.mint(address to, uint256 amount) external => mintCVL(calledContract, to, amount) expect void;
    function _.burn(address from, uint256 amount) external => burnCVL(calledContract, from, amount) expect void;
    function _.forcedMove(address from, address to, uint256 amount) external
        => moveCVL(calledContract, from, to, amount) expect void;
    function _.initialize(string, string, address, uint8) external => NONDET;

    // Vesting, the Governors and a custom transfer rule.
    function _.lockedOf(address captable, uint8 classId, address account, uint64 t) external
        => lockedGhost[classId][account] expect uint128;
    function _.pendingUntil() external => pendingGhost[calledContract] expect uint48;
    function _.allowed(uint8, address, address, uint256) external => NONDET;

    // Hats mutators (H5): none is ever called by the Captable.
    function _.mintHat(uint256, address) external => markHats() expect bool;
    function _.createHat(uint256, string, uint32, address, address, bool, string) external => markHatsId() expect uint256;
    function _.transferHat(uint256, address, address) external => markHatsVoid() expect void;
    function _.changeHatEligibility(uint256, address) external => markHatsVoid() expect void;
    function _.changeHatToggle(uint256, address) external => markHatsVoid() expect void;
    function _.checkHatWearerStatus(uint256, address) external => markHats() expect bool;
}

// ------------------------------------------------------------------------------------------------
// Ghosts and their CVL functions
// ------------------------------------------------------------------------------------------------

ghost mapping(address => mathint) supplyGhost;
ghost mapping(address => mapping(address => mathint)) balanceGhost;
ghost mapping(address => mapping(address => uint256)) votesGhost;
ghost mapping(address => mapping(uint256 => uint256)) pastSupplyGhost;
ghost mapping(address => mapping(uint256 => uint256)) safePastGhost;
ghost mapping(uint8 => mapping(address => uint128)) lockedGhost;
ghost mapping(address => uint48) pendingGhost;
ghost bool hatsMutated;

function supplyCVL(address token) returns uint256 {
    require supplyGhost[token] <= max_uint256;
    return assert_uint256(supplyGhost[token]);
}

function balanceCVL(address token, address a) returns uint256 {
    require balanceGhost[token][a] <= supplyGhost[token];
    return assert_uint256(balanceGhost[token][a]);
}

function votesCVL(address token, address a) returns uint256 {
    // Token-level E8 (ShareClass.spec): the Safe is never delegated.
    if (a == safe()) {
        return 0;
    }
    return votesGhost[token][a];
}

function pastSupplyCVL(address token, uint256 t) returns uint256 {
    require safePastGhost[token][t] <= pastSupplyGhost[token][t];
    return pastSupplyGhost[token][t];
}

function safePastCVL(address token, uint256 t) returns uint256 {
    require safePastGhost[token][t] <= pastSupplyGhost[token][t];
    return safePastGhost[token][t];
}

function mintCVL(address token, address to, uint256 amount) {
    supplyGhost[token] = supplyGhost[token] + amount;
    balanceGhost[token][to] = balanceGhost[token][to] + amount;
}

function burnCVL(address token, address from, uint256 amount) {
    if (balanceGhost[token][from] < to_mathint(amount)) {
        revert("burn exceeds balance");
    }
    supplyGhost[token] = supplyGhost[token] - amount;
    balanceGhost[token][from] = balanceGhost[token][from] - amount;
}

function moveCVL(address token, address from, address to, uint256 amount) {
    if (balanceGhost[token][from] < to_mathint(amount)) {
        revert("move exceeds balance");
    }
    balanceGhost[token][from] = balanceGhost[token][from] - amount;
    balanceGhost[token][to] = balanceGhost[token][to] + amount;
}

function markHats() returns bool {
    hatsMutated = true;
    bool any;
    return any;
}

function markHatsId() returns uint256 {
    hatsMutated = true;
    uint256 any;
    return any;
}

function markHatsVoid() {
    hatsMutated = true;
}

definition isGovernorOnly(method f) returns bool =
    f.selector == sig:createClass(ICaptable.ClassParams).selector
    || f.selector == sig:setAuthorised(uint8, uint128).selector
    || f.selector == sig:setTransferRule(uint8, ICaptable.TransferRule, address).selector
    || f.selector == sig:freeze(uint8).selector
    || f.selector == sig:setClassGovernor(uint8, address).selector;

definition isModule(address a) returns bool = a == options() || a == rounds() || a == vesting();

// ------------------------------------------------------------------------------------------------
// E1: issued plus convertible reserve never exceeds authorised.
// ------------------------------------------------------------------------------------------------

invariant E1_authorised(uint8 classId)
    classId < numberOfClasses()
        => supplyGhost[tokenOf(classId)] + convertibleReserved(classId) <= to_mathint(authorisedOf(classId))
    filtered { f -> !f.isView }

// ------------------------------------------------------------------------------------------------
// E2: who issues, and who decides the reserved matters.
// ------------------------------------------------------------------------------------------------

/// A successful issue came from the Safe, or from Options, Rounds or Vesting within its allowance, which
/// then drops by exactly the amount.
rule E2_whoIssues(env e, uint8 classId, address to, uint128 amount, bytes32 reason) {
    uint128 allowanceBefore = issuerAllowance(e.msg.sender, classId);

    issue(e, classId, to, amount, reason);

    uint128 allowanceAfter = issuerAllowance(e.msg.sender, classId);
    assert e.msg.sender == safe()
        || (isModule(e.msg.sender) && allowanceBefore >= amount && allowanceAfter == allowanceBefore - amount),
        "issued by someone without the right";
}

/// createClass, setAuthorised, setTransferRule, freeze and setClassGovernor revert for anyone but the
/// company Governor.
rule E2_governorOnly(env e, method f, calldataarg args) filtered { f -> isGovernorOnly(f) } {
    f@withrevert(e, args);
    assert !lastReverted => e.msg.sender == governor(), "a reserved matter without the Governor";
}

// ------------------------------------------------------------------------------------------------
// E4: a conversion price never rises and never goes below its floor.
// ------------------------------------------------------------------------------------------------

rule E4_cpNeverRises(env e, method f, calldataarg args, uint8 classId) filtered { f -> !f.isView } {
    require classId < numberOfClasses();
    uint128 before = conversionPriceAt(e, classId, e.block.timestamp);

    f(e, args);

    uint128 after = conversionPriceAt(e, classId, e.block.timestamp);
    assert after <= before, "a conversion price rose";
    assert originalIssuePriceOf(classId) > 0 => after >= floorOf(classId), "below the floor";
}

// ------------------------------------------------------------------------------------------------
// E7 (D3): a forced transfer needs the Governor, or the Safe or Exits with matching unused consent.
// ------------------------------------------------------------------------------------------------

rule E7_forcedNeedsVoteOrConsent(env e, uint8 classId, address from, address to, uint128 amount, bytes32 reason) {
    bytes32 id = consentIdOf(classId, from, to, amount, reason);
    bool consentBefore = transferConsent(id);
    address token = tokenOf(classId);
    mathint balanceBefore = balanceGhost[token][from];
    uint128 locked = lockedGhost[classId][from];

    forcedTransfer(e, classId, from, to, amount, reason);

    assert e.msg.sender == governor()
        || ((e.msg.sender == safe() || e.msg.sender == exits()) && consentBefore && !transferConsent(id)),
        "forced without a vote or consent";
    assert balanceBefore - amount >= to_mathint(locked), "moved locked shares";
    assert reason != to_bytes32(0), "no reason";
}

/// Consent is used at most once: a second identical forced transfer by the Safe or Exits reverts.
rule E7_consentUsedOnce(env e1, env e2, uint8 classId, address from, address to, uint128 amount, bytes32 reason) {
    require e1.msg.sender == safe() || e1.msg.sender == exits();
    require e2.msg.sender == safe() || e2.msg.sender == exits();

    forcedTransfer(e1, classId, from, to, amount, reason);
    forcedTransfer@withrevert(e2, classId, from, to, amount, reason);

    assert lastReverted, "one consent moved shares twice";
}

// ------------------------------------------------------------------------------------------------
// E8 (D5): the Safe's shares carry no votes and are left out of the supply.
// ------------------------------------------------------------------------------------------------

rule E8_safeHasNoVotes(env e, uint256 t) {
    assert getVotes(e, safe()) == 0, "the Safe votes now";
    assert getPastVotes(e, safe(), t) == 0, "the Safe voted then";
}

/// With one voting Common-style class (weight 1, ratio 1), the company supply at t is the class supply less
/// the Safe's balance at t.
rule E8_safeLeftOutOfSupply(env e, uint256 t) {
    require numberOfClasses() == 1;
    require weightOf(0) == 1 && originalIssuePriceOf(0) == 0;
    address token = tokenOf(0);

    uint256 supply = getPastTotalSupply(e, t);

    assert to_mathint(supply) == pastSupplyGhost[token][t] - safePastGhost[token][t], "the Safe's shares counted";
}

// ------------------------------------------------------------------------------------------------
// E10 (N-5): convert lowers the source's authorised by the amount, and E1 holds in both classes after.
// ------------------------------------------------------------------------------------------------

rule E10_convertLowersSource(env e, uint8 classId, uint128 amount) {
    uint8 target = convertsIntoOf(classId);
    requireInvariant E1_authorised(classId);
    requireInvariant E1_authorised(target);
    uint128 authorisedBefore = authorisedOf(classId);

    convert(e, classId, amount);

    assert to_mathint(authorisedOf(classId)) == authorisedBefore - amount, "source authorised not lowered";
    assert supplyGhost[tokenOf(classId)] + convertibleReserved(classId) <= to_mathint(authorisedOf(classId)), "E1 source";
    assert supplyGhost[tokenOf(target)] + convertibleReserved(target) <= to_mathint(authorisedOf(target)), "E1 target";
}

// ------------------------------------------------------------------------------------------------
// E11 (D6): no issue into a voting class while a proposal is pending.
// ------------------------------------------------------------------------------------------------

rule E11_noIssueWhilePending(env e, uint8 classId, address to, uint128 amount, bytes32 reason) {
    require weightOf(classId) > 0;
    require e.block.timestamp <= to_mathint(pendingGhost[governor()]);

    issue@withrevert(e, classId, to, amount, reason);

    assert lastReverted, "issued while a proposal was pending";
}

/// A class Governor's pending window holds up its own class, whatever its weight.
rule E11_classGovernorWindow(env e, uint8 classId, address to, uint128 amount, bytes32 reason) {
    address classGov = classGovernorOf(classId);
    require classGov != 0;
    require e.block.timestamp <= to_mathint(pendingGhost[classGov]);

    issue@withrevert(e, classId, to, amount, reason);

    assert lastReverted, "issued while the class Governor's proposal was pending";
}

// ------------------------------------------------------------------------------------------------
// H4 and H5
// ------------------------------------------------------------------------------------------------

/// The Board-only and module-only functions: setIssuerAllowance only by the Safe; setConversionPrice only by the
/// Governor or Rounds (F8: never the Safe); burnUnvested only by Vesting; burnForExit and closeForExit only by
/// Exits. No hat satisfies any of them.
rule H4_boardOnly_Captable(env e, method f, calldataarg args) filtered { f -> !f.isView } {
    f@withrevert(e, args);
    bool ok = !lastReverted;

    assert ok && f.selector == sig:setIssuerAllowance(address, uint8, uint128).selector => e.msg.sender == safe();
    assert ok && f.selector == sig:setConversionPrice(uint8, uint128).selector
        => e.msg.sender == governor() || e.msg.sender == rounds();
    assert ok && f.selector == sig:burnUnvested(uint8, address, uint128).selector => e.msg.sender == vesting();
    assert ok && f.selector == sig:burnForExit(uint8, address, uint128).selector => e.msg.sender == exits();
    assert ok && f.selector == sig:closeForExit().selector => e.msg.sender == exits();
}

rule H5_noHatsMutation(env e, method f, calldataarg args) filtered { f -> !f.isView } {
    require !hatsMutated;
    f(e, args);
    assert !hatsMutated, "the Captable changed Hats";
}
