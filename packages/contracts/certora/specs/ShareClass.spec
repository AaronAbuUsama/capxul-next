// ShareClass rules (docs/planning/protocol-v4/fv/certora.md, invariants E6 and E8; ruling D5).
//
// Summaries
// - The Captable's `checkTransfer` is a CVL function over a ghost transfer rule `allowedGhost`, standing for
//   the class's rule (a custom rule summarised NONDET, as fv/certora.md says): it records that it was asked
//   and reverts when the rule refuses. Captable `safe()` is only read once, in `initialize`.
// - Everything else is ShareClass's own code (OpenZeppelin ERC20VotesUpgradeable).

methods {
    function safe() external returns (address) envfree;
    function captable() external returns (address) envfree;
    function classId() external returns (uint8) envfree;
    function balanceOf(address) external returns (uint256) envfree;
    function totalSupply() external returns (uint256) envfree;
    function getVotes(address) external returns (uint256) envfree;
    function delegates(address) external returns (address) envfree;
    function allowance(address, address) external returns (uint256) envfree;

    function _.checkTransfer(uint8 classId, address from, address to, uint256 amount) external
        => checkTransferCVL(from, to) expect void;
    function _.safe() external => NONDET;
}

ghost mapping(address => mapping(address => bool)) allowedGhost;
ghost bool checkedGhost;
ghost address checkedFrom;
ghost address checkedTo;

function checkTransferCVL(address from, address to) {
    checkedGhost = true;
    checkedFrom = from;
    checkedTo = to;
    if (!allowedGhost[from][to]) {
        revert("TransferNotAllowed");
    }
}

/// E6 (token half, R1 T-4): a successful ordinary `transfer` between two nonzero accounts was asked of the
/// Captable for exactly that pair, and the rule allowed it.
rule E6_transferRule(env e, address to, uint256 amount) {
    require e.msg.sender != captable();
    require e.msg.sender != 0 && to != 0;
    require !checkedGhost;

    transfer(e, to, amount);

    assert checkedGhost && checkedFrom == e.msg.sender && checkedTo == to, "transfer skipped the Captable";
    assert allowedGhost[e.msg.sender][to], "transfer the rule refused";
}

/// E6 (token half): the same for `transferFrom`, where the shareholder is `from`.
rule E6_transferFromRule(env e, address from, address to, uint256 amount) {
    require e.msg.sender != captable();
    require from != 0 && to != 0;
    require !checkedGhost;

    transferFrom(e, from, to, amount);

    assert checkedGhost && checkedFrom == from && checkedTo == to, "transferFrom skipped the Captable";
    assert allowedGhost[from][to], "transferFrom the rule refused";
}

/// E6 / T-3: shares move without the rule only by the Captable (`mint`, `burn`, `forcedMove`).
rule E6_onlyCaptableSkipsTheRule(env e, method f, calldataarg args)
    filtered { f -> !f.isView }
{
    address a;
    uint256 before = balanceOf(a);
    require !checkedGhost;

    f(e, args);

    assert balanceOf(a) != before => (checkedGhost || e.msg.sender == captable()),
        "a balance changed without the rule and not by the Captable";
}

// The parametric E8 rules leave out `initialize`: from the Prover's arbitrary start state it re-reads `safe()`
// (NONDET) and would name a new Safe with someone else's votes. A clone is initialised once on empty storage;
// the initialize tree and I3 cover that call.

/// E8 (the step Captable.spec assumes in `votesCVL`): no call makes any account delegate to the Safe.
rule E8_nobodyDelegatesToSafe(env e, method f, calldataarg args, address a)
    filtered { f -> !f.isView && f.selector != sig:initialize(string,string,address,uint8).selector }
{
    require delegates(a) != safe();

    f(e, args);

    assert delegates(a) != safe(), "an account now delegates to the Safe";
}

/// E8: the Safe's votes are 0 after any call, given they were before. From an arbitrary start state an account
/// may already delegate to the Safe; E8_nobodyDelegatesToSafe rules that state out inductively, so a
/// counterexample here that starts from it is spurious.
rule E8_safeHasNoVotes(env e, method f, calldataarg args)
    filtered { f -> !f.isView && f.selector != sig:initialize(string,string,address,uint8).selector }
{
    require getVotes(safe()) == 0;
    require delegates(safe()) == 0;

    f(e, args);

    assert getVotes(safe()) == 0, "the Safe has votes";
    assert delegates(safe()) == 0, "the Safe has a delegate";
}

/// E8: the Safe's checkpoint at now equals its balance after any call, given it did before.
rule E8_safeBalanceTracked(env e, method f, calldataarg args)
    filtered { f -> !f.isView && f.selector != sig:initialize(string,string,address,uint8).selector }
{
    env eRead;
    require eRead.block.timestamp == e.block.timestamp;
    require safeBalanceAt(eRead, e.block.timestamp) == balanceOf(safe());

    f(e, args);

    assert safeBalanceAt(eRead, e.block.timestamp) == balanceOf(safe()), "safeBalanceAt(now) != balanceOf(safe)";
}

/// E8: a delegation reverts exactly when the Safe is the delegator or the delegatee. The "only if" half keeps
/// the rule red on the reverting stub (an ordinary delegation must succeed); its requires rule out states no
/// call sequence reaches (the old delegate holding fewer votes than the delegator's balance, overflow).
rule E8_noDelegationToOrFromSafe(env e, address delegatee) {
    address previousDelegate = delegates(e.msg.sender);
    require e.msg.value == 0;
    require e.msg.sender != 0 && delegatee != 0;
    require previousDelegate == 0 || getVotes(previousDelegate) >= balanceOf(e.msg.sender);
    require getVotes(delegatee) + balanceOf(e.msg.sender) <= max_uint208;
    require e.block.timestamp <= max_uint48;

    delegate@withrevert(e, delegatee);
    bool reverted = lastReverted;

    assert reverted <=> (delegatee == safe() || e.msg.sender == safe()), "delegation refused or allowed wrongly";
}
