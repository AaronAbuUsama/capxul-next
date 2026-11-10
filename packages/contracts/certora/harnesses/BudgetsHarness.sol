// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Budgets } from "../../src/money/Budgets.sol";

/// @notice Budgets with its storage readable raw, for Budgets.spec (fv/certora.md "Budgets.spec"). It only
/// reads: no behaviour changes. Views on Budgets return effective values; these return what is stored.
contract BudgetsHarness is Budgets {
    constructor(address payments_, address hats_) Budgets(payments_, hats_) { }

    function parentOf(uint256 id) external view returns (uint256) {
        return _budgets[id].parent;
    }

    function safeOf(uint256 id) external view returns (address) {
        return _budgets[id].safe;
    }

    function hatOf(uint256 id) external view returns (uint256) {
        return _budgets[id].hat;
    }

    function tokenOf(uint256 id) external view returns (address) {
        return _budgets[id].token;
    }

    function periodOf(uint256 id) external view returns (uint8) {
        return _budgets[id].period;
    }

    function depthOf(uint256 id) external view returns (uint8) {
        return _budgets[id].depth;
    }

    function closedOf(uint256 id) external view returns (bool) {
        return _budgets[id].closed;
    }

    function amountOf(uint256 id) external view returns (uint128) {
        return _budgets[id].amount;
    }

    function childrenAmountOf(uint256 id) external view returns (uint128) {
        return _budgets[id].childrenAmount;
    }

    function ownSpentRaw(uint256 id) external view returns (uint128) {
        return _budgets[id].ownSpent;
    }

    function spentRaw(uint256 id) external view returns (uint128) {
        return _budgets[id].spent;
    }

    function ownCommittedOf(uint256 id) external view returns (uint128) {
        return _budgets[id].ownCommitted;
    }

    function committedOf(uint256 id) external view returns (uint128) {
        return _budgets[id].committed;
    }

    function periodIndexOf(uint256 id) external view returns (uint64) {
        return _budgets[id].periodIndex;
    }

    function scheduledStateOf(uint256 sid) external view returns (uint8) {
        return uint8(_scheduled[sid].state);
    }

    function scheduledBudgetOf(uint256 sid) external view returns (uint256) {
        return _scheduled[sid].budgetId;
    }

    function scheduledAmountOf(uint256 sid) external view returns (uint128) {
        return _scheduled[sid].amount;
    }

    function scheduledPayAtOf(uint256 sid) external view returns (uint64) {
        return _scheduled[sid].payAt;
    }

    function rolesOf(address safe) external view returns (address) {
        return _configs[safe].roles;
    }

    function roleKeyOf(address safe) external view returns (bytes32) {
        return _configs[safe].payoutRoleKey;
    }

    function isEntered() external view returns (bool) {
        return _entered;
    }
}
