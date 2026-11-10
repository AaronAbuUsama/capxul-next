// SPDX-License-Identifier: GPL-3.0-or-later
//
// B16 (D10): no state-changing Budgets function succeeds while another one is on the call stack
// (docs/planning/protocol-v4/fv/certora.md "Payout calls and D10"). The Roles payout is the linked
// BudgetsReentrantRolesHarness, which calls back the Budgets entry point `which` from inside the payout and
// records whether it succeeded. A payout happens in spend, execute and payReserved; Budgets makes no other
// state-changing external call (Hats reads are views), so these are the only places re-entry can start.
//
// Vacuity: each rule's outer call is made without @withrevert, so on the reverting stub every path is pruned
// and `--rule_sanity basic` flags the rule.

using BudgetsReentrantRolesHarness as roles;

methods {
    function roles.reentered() external returns (bool) envfree;
    function roles.reentrySucceeded() external returns (bool) envfree;
    function roles.reentryError() external returns (bytes4) envfree;
    function roles.budgets() external returns (address) envfree;

    function _.execTransactionWithRole(address, uint256, bytes, uint8, bytes32, bool) external
        => DISPATCHER(true);
    function _.paymentId(IPayments.PaymentItem) external => NONDET;
    function _.isWearerOfHat(address, uint256) external => NONDET;
    function _.isInGoodStanding(address, uint256) external => NONDET;
}

/// bytes4(keccak256("ReentrantCall()")), IBudgets.ReentrantCall.
definition REENTRANT_CALL() returns bytes4 = to_bytes4(0x37ed32e8);

function outerPayout(env e, uint8 which, uint256 id, address to, uint128 amount, bytes32 doc, bytes32 job) {
    require roles.budgets() == currentContract;
    require !roles.reentered();
    if (which == 0) {
        spend(e, id, to, amount, 0, doc, job);
    } else if (which == 1) {
        execute(e, id);
    } else {
        payReserved(e, id, to, amount, doc, job);
    }
}

rule B16_lockRefusesReentry(env e, uint8 which, uint256 id, address to, uint128 amount, bytes32 doc,
    bytes32 job)
{
    outerPayout(e, which, id, to, amount, doc, job);
    assert roles.reentered() => !roles.reentrySucceeded();
    assert roles.reentered() => roles.reentryError() == REENTRANT_CALL();
}
