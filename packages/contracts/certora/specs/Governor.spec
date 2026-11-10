// Governor rules (docs/planning/protocol-v4/fv/certora.md "Governor.spec"; invariants G1 and G5).
//
// Summaries
// - The votes contract (the Captable or a ShareClass token) is summarised NONDET: G1 and G5 do not depend on
//   any vote count, only on who may propose what and who may change the settings. `clock` is NONDET too; the
//   rules never compare times.
// - Calls `execute` makes to its targets are left unresolved (the Prover havocs them). The G5 rule about
//   `execute` reads only the proposal's state before the calls.
//
// Vacuity (verification-loop.md "TDD", ruling K7). Every rule first reads `safe()` or a setting without
// `@withrevert`; on the reverting stub that read reverts, every path is pruned, and `--rule_sanity basic`
// flags the rule. On the implementation those reads cannot revert.

methods {
    function safe() external returns (address) envfree;
    function isAllowedTarget(address) external returns (bool) envfree;
    function votingDelay() external returns (uint256) envfree;
    function votingPeriod() external returns (uint256) envfree;
    function proposalThreshold() external returns (uint256) envfree;
    function quorumNumerator() external returns (uint256) envfree;
    function hashProposal(address[], uint256[], bytes[], bytes32) external returns (uint256) envfree;
    function stateIndex(uint256) external returns (uint8);

    function _.getPastVotes(address, uint256) external => NONDET;
    function _.getPastTotalSupply(uint256) external => NONDET;
    function _.getVotes(address) external => NONDET;
    function _.clock() external => NONDET;
    function _.CLOCK_MODE() external => NONDET;
    function _.safeBalanceAt(uint256) external => NONDET;
}

definition isSetter(method f) returns bool =
    f.selector == sig:setVotingDelay(uint48).selector
    || f.selector == sig:setVotingPeriod(uint32).selector
    || f.selector == sig:setProposalThreshold(uint256).selector
    || f.selector == sig:updateQuorumNumerator(uint256).selector;

definition isExecute(method f) returns bool =
    f.selector == sig:execute(address[], uint256[], bytes[], bytes32).selector;

definition isInitialize(method f) returns bool =
    f.selector == sig:initialize(string, address, address, address[], uint48, uint32, uint256, uint256).selector;

/// G1 (bounded): a proposal with any target that is the company Safe, or outside the allowed list, reverts.
rule G1_neverTheSafe(env e, address[] targets, uint256[] values, bytes[] calldatas, string proposalDescription, uint256 i) {
    address companySafe = safe();
    require i < targets.length;
    bool forbidden = targets[i] == companySafe || !isAllowedTarget(targets[i]);

    propose@withrevert(e, targets, values, calldatas, proposalDescription);

    assert forbidden => lastReverted, "proposed the Safe or a target off the list";
}

/// G1: the Safe is never an allowed target, from the constructor on. Nothing but `initialize` writes the
/// list or the Safe, and `initialize` refuses the Safe in the list and a Safe equal to the Governor itself
/// (which it always adds).
invariant G1_safeNeverAllowed()
    !isAllowedTarget(safe());

/// G1: `relay` always reverts.
rule G1_relayAlwaysReverts(env e, address to, uint256 value, bytes data) {
    address companySafe = safe();

    relay@withrevert(e, to, value, data);

    assert lastReverted, "relay succeeded";
}

/// G5: a setter succeeds only when the Governor calls itself, which it does only from `execute` (relay is
/// dead, G1); the Safe and everyone else are refused.
rule G5_settersOnlyByTheGovernor(env e, method f, calldataarg args) filtered { f -> isSetter(f) } {
    uint256 before = votingDelay();

    f@withrevert(e, args);

    assert !lastReverted => e.msg.sender == currentContract, "a setting changed outside a proposal";
}

/// G5: no other function changes a setting (initialisation of a fresh clone aside).
rule G5_settingsOnlyByProposal(env e, method f, calldataarg args)
    filtered { f -> !f.isView && !isSetter(f) && !isExecute(f) && !isInitialize(f) }
{
    uint256 delayBefore = votingDelay();
    uint256 periodBefore = votingPeriod();
    uint256 thresholdBefore = proposalThreshold();
    uint256 numeratorBefore = quorumNumerator();

    f(e, args);

    assert votingDelay() == delayBefore, "delay changed";
    assert votingPeriod() == periodBefore, "period changed";
    assert proposalThreshold() == thresholdBefore, "threshold changed";
    assert quorumNumerator() == numeratorBefore, "numerator changed";
}

/// G5: `execute` runs only a passed proposal (Succeeded, or Queued, which this Governor never uses).
rule G5_executeOnlyPassed(env e, address[] targets, uint256[] values, bytes[] calldatas, bytes32 descriptionHash) {
    uint256 numeratorBefore = quorumNumerator();
    uint256 id = hashProposal(targets, values, calldatas, descriptionHash);
    uint8 stateBefore = stateIndex(e, id);

    execute(e, targets, values, calldatas, descriptionHash);

    assert stateBefore == 4 || stateBefore == 5, "executed a proposal that had not passed";
}
