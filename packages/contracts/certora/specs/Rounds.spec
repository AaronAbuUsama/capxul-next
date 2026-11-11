// Rounds rules (docs/planning/protocol-v4/fv/certora.md "Rounds.spec"; invariants R2 in the exact form of ruling
// D14, R3, H4 and H5).
//
// Summaries
// - The Captable is a clone per company, so no instance is linked (fv/certora.md: never rely on dynamic_bound for
//   clones). `issue` credits `classBalance[classId][to]` and sets `issuedAny`; it may also revert (a pending
//   proposal, ruling D6, or an exhausted issuer allowance), which `issueMayRevert` models. Its other calls are
//   NONDET: E4 and the class terms are the Captable spec's business.
// - Payments is the real contract and the round token the standard ERC-20 harness; every token call and
//   `Payments.send` is DISPATCHER(true), so the money really moves investor -> Rounds -> Safe.
// - Every state-changing Hats function sets `hatsMutated` (H5). Rounds has no Hats reference at all.
//
// Vacuity (verification-loop.md "TDD", ruling K7). Every rule first reads a Rounds view (`safe()`,
// `pricedRound(id)`) without `@withrevert`: on the reverting stub that read reverts, every path is pruned and
// `--rule_sanity basic` flags the rule. On the implementation those views cannot revert.

using PaymentsDummyERC20 as token;
using Payments as paymentsContract;

methods {
    function safe() external returns (address) envfree;
    function payments() external returns (address) envfree;
    function pricedRound(uint256) external returns (IRounds.PricedRound) envfree;
    function position(uint256, address) external returns (IRounds.Position) envfree;
    function token.balanceOf(address) external returns (uint256) envfree;

    function _.transferFrom(address, address, uint256) external => DISPATCHER(true);
    function _.transfer(address, uint256) external => DISPATCHER(true);
    function _.approve(address, uint256) external => DISPATCHER(true);
    function _.balanceOf(address) external => DISPATCHER(true);
    function _.allowance(address, address) external => DISPATCHER(true);
    function _.send(IPayments.PaymentItem) external => DISPATCHER(true);
    function _.paymentId(IPayments.PaymentItem) external => DISPATCHER(true);
    function _.decimals() external => NONDET;

    function _.issue(uint8 classId, address to, uint128 amount, bytes32) external
        => issueCVL(classId, to, amount) expect void;
    function _.setConversionPrice(uint8, uint128) external => NONDET;
    function _.conversionPriceAt(uint8, uint256) external => NONDET;
    function _.numberOfClasses() external => NONDET;
    function _.PRICE_DECIMALS() external => NONDET;

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

// ------------------------------------------------------------------ the Captable stand-in

ghost mapping(uint8 => mapping(address => mathint)) classBalance;
ghost bool issuedAny;
ghost bool issueMayRevert;

function issueCVL(uint8 classId, address to, uint128 amount) {
    if (issueMayRevert) {
        revert("the Captable refused");
    }
    classBalance[classId][to] = classBalance[classId][to] + amount;
    issuedAny = true;
}

// ------------------------------------------------------------------ Hats (H5)

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

// ------------------------------------------------------------------ R2 (exact form, D14)

/// R2 / R1: a successful `pay` raises the investor's class balance by exactly their allocated `shares` and the
/// Safe's token balance by exactly `shares * price`; a reverted `pay` does neither.
rule R2_payAndReceive(env e) {
    uint256 roundId;
    IRounds.PricedRound r = pricedRound(roundId);
    IRounds.Position p = position(roundId, e.msg.sender);
    address s = safe();
    require r.token == token;
    require payments() == paymentsContract;
    require s != e.msg.sender && s != currentContract && s != paymentsContract;
    require e.msg.sender != currentContract && e.msg.sender != paymentsContract;
    uint8 k = r.classId;

    mathint sharesBefore = classBalance[k][e.msg.sender];
    mathint safeBefore = token.balanceOf(s);
    mathint investorBefore = token.balanceOf(e.msg.sender);

    pay@withrevert(e, roundId);
    bool ok = !lastReverted;

    assert ok => classBalance[k][e.msg.sender] == sharesBefore + p.shares, "exactly the allocated shares";
    assert ok => token.balanceOf(s) == safeBefore + p.shares * r.price, "the Safe got exactly shares x price";
    assert ok => token.balanceOf(e.msg.sender) == investorBefore - p.shares * r.price, "the investor paid it";
    assert ok => p.shares > 0 && !p.paid, "only an allocated, unpaid investor is paid shares";
    assert !ok => classBalance[k][e.msg.sender] == sharesBefore && token.balanceOf(s) == safeBefore,
        "a refused pay moves nothing";
}

/// R2: no other function issues shares to anyone (shares only come with a payment, or a SAFE conversion in the
/// Board's batch).
rule R2_onlyPayAndConvertIssue(env e, method f, calldataarg args) filtered { f -> !f.isView } {
    address s = safe();
    require !issuedAny;
    f(e, args);
    assert issuedAny => f.selector == sig:pay(uint256).selector
        || (f.selector == sig:convertSafes(uint256[], uint256, uint256).selector && e.msg.sender == s);
}

// ------------------------------------------------------------------ R3

/// R3: after a round's pay-by date, or once closed or cancelled, `pay` reverts and issues nothing.
rule R3_closedIssuesNothing(env e) {
    uint256 roundId;
    IRounds.PricedRound r = pricedRound(roundId);
    require r.closed || r.cancelled || e.block.timestamp > r.payBy;
    require !issuedAny;

    pay@withrevert(e, roundId);

    assert lastReverted && !issuedAny;
}

/// R3: the other issue path, SAFE conversion into the round, reverts in the same states.
rule R3_closedIssuesNothing_convertSafes(env e) {
    uint256 roundId;
    uint256[] noteIds;
    uint256 capitalization;
    IRounds.PricedRound r = pricedRound(roundId);
    require r.closed || r.cancelled || e.block.timestamp > r.payBy;
    require !issuedAny;

    convertSafes@withrevert(e, noteIds, roundId, capitalization);

    assert lastReverted && !issuedAny;
}

// ------------------------------------------------------------------ H4 and H5

definition isBoardOnly(method f) returns bool =
    f.selector == sig:createSafeRound(address, uint128, uint16, uint64, bytes32).selector
    || f.selector == sig:inviteSafe(uint256, address, uint128).selector
    || f.selector == sig:closeSafeRound(uint256).selector
    || f.selector == sig:convertSafes(uint256[], uint256, uint256).selector
    || f.selector == sig:createPricedRound(uint8, address, uint128, uint128, uint64, bytes32).selector
    || f.selector == sig:invite(uint256, address, uint128).selector
    || f.selector == sig:allocate(uint256, address, uint128).selector
    || f.selector == sig:close(uint256, uint256).selector
    || f.selector == sig:cancel(uint256).selector;

/// H4: every Safe function of Rounds succeeds only when the company Safe calls it. No hat satisfies it.
rule H4_boardOnly_Rounds(env e, method f, calldataarg args) filtered { f -> !f.isView && isBoardOnly(f) } {
    address s = safe();
    f@withrevert(e, args);
    assert !lastReverted => e.msg.sender == s;
}

/// H5: Rounds never calls a state-changing Hats function.
rule H5_noHatsMutation(env e, method f, calldataarg args) filtered { f -> !f.isView } {
    require !hatsMutated;
    f(e, args);
    assert !hatsMutated, "Rounds changed Hats";
}
