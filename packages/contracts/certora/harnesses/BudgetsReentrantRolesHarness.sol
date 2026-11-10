// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IBudgets } from "../../src/interfaces/IBudgets.sol";

/// @notice B16's callback harness (fv/certora.md "Payout calls and D10"): a Roles stand-in whose
/// `execTransactionWithRole` calls back one state-changing Budgets entry point, chosen by `which`, and
/// records whether that inner call succeeded and the error it returned. It never writes Budgets' storage
/// itself, and otherwise succeeds as the real payout does.
contract BudgetsReentrantRolesHarness {
    IBudgets public budgets;
    uint8 public which;
    uint256 public argId;
    uint128 public argAmount;
    address public argTo;
    bool public reentered;
    bool public reentrySucceeded;
    bytes4 public reentryError;

    function execTransactionWithRole(address, uint256, bytes calldata, uint8, bytes32, bool) external returns (bool) {
        reentered = true;
        bytes memory call = _call();
        (bool ok, bytes memory ret) = address(budgets).call(call);
        reentrySucceeded = ok;
        if (!ok && ret.length >= 4) reentryError = bytes4(ret);
        return true;
    }

    function _call() internal view returns (bytes memory) {
        uint8 k = which % 15;
        bytes32 doc = keccak256("doc");
        if (k == 0) return abi.encodeCall(IBudgets.spend, (argId, argTo, argAmount, 0, doc, doc));
        if (k == 1) return abi.encodeCall(IBudgets.schedule, (argId, argTo, argAmount, 0, type(uint64).max, doc));
        if (k == 2) return abi.encodeCall(IBudgets.cancel, (argId));
        if (k == 3) return abi.encodeCall(IBudgets.execute, (argId));
        if (k == 4) return abi.encodeCall(IBudgets.commit, (argId, argAmount));
        if (k == 5) return abi.encodeCall(IBudgets.release, (argId, argAmount));
        if (k == 6) return abi.encodeCall(IBudgets.payReserved, (argId, argTo, argAmount, doc, doc));
        if (k == 7) return abi.encodeCall(IBudgets.createChildBudget, (argId, argAmount, argId));
        if (k == 8) return abi.encodeCall(IBudgets.createTopBudget, (argTo, 0, argAmount, argId));
        if (k == 9) return abi.encodeCall(IBudgets.setAmount, (argId, argAmount));
        if (k == 10) return abi.encodeCall(IBudgets.setHat, (argId, argId));
        if (k == 11) return abi.encodeCall(IBudgets.close, (argId));
        if (k == 12) return abi.encodeCall(IBudgets.reopen, (argId));
        if (k == 13) return abi.encodeCall(IBudgets.configure, (argTo, doc));
        return abi.encodeCall(IBudgets.setAgreements, (argTo));
    }
}
