// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IAgreements } from "../../src/interfaces/IAgreements.sol";
import { IBudgets } from "../../src/interfaces/IBudgets.sol";

/// @notice The Budgets that Agreements.spec dispatches to (fv/certora.md "Agreements.spec"). State is free:
/// the Prover starts from any storage, so `auth`, each budget and its `ownCommitted` are whatever a rule
/// requires. `payReserved` pays nothing and returns a fresh id, or, with `reenter` set, first calls back one
/// state-changing Agreements function chosen by `which` and records whether that inner call succeeded and
/// the error it returned (A11's callback harness). It never writes Agreements' storage itself.
contract AgreementsBudgetsHarness {
    mapping(uint256 id => mapping(address who => bool)) public auth;
    mapping(uint256 id => IBudgets.Budget) internal _budgets;
    address public agreements;

    bool public reenter;
    uint8 public which;
    uint256 public argId;
    uint128 public argAmount;
    uint64 public argTime;
    bool public reentered;
    bool public reentrySucceeded;
    bytes4 public reentryError;
    uint256 public payCalls;

    /// @dev As Budgets (spec/budgets.md): false for an id that was never created, so a rule's
    /// `isAuthorised` read does not revert and prune the unknown-budget path.
    function authorised(uint256 id, address who) external view returns (bool) {
        if (_budgets[id].safe == address(0)) return false;
        return who == _budgets[id].safe || auth[id][who];
    }

    /// @dev As Budgets: the zero record for an id that was never created (Agreements' `offer` names it
    /// `UnknownBudget` itself).
    function budgetOf(uint256 id) external view returns (IBudgets.Budget memory r) {
        if (_budgets[id].safe == address(0)) return r;
        return _budgets[id];
    }

    function leftOf(uint256 id) public view returns (uint128) {
        IBudgets.Budget storage b = _budgets[id];
        return b.amount > b.ownCommitted ? b.amount - b.ownCommitted : 0;
    }

    function ownCommitted(uint256 id) external view returns (uint128) {
        return _budgets[id].ownCommitted;
    }

    function commit(uint256 id, uint128 amount) external {
        if (msg.sender != agreements) revert IBudgets.OnlyAgreements();
        if (_budgets[id].closed) revert IBudgets.BudgetIsClosed(id);
        uint128 left = leftOf(id);
        if (amount > left) revert IBudgets.OverBudget(id, left, amount);
        _budgets[id].ownCommitted += amount;
    }

    function release(uint256 id, uint128 amount) external {
        if (msg.sender != agreements) revert IBudgets.OnlyAgreements();
        _budgets[id].ownCommitted -= amount;
    }

    function payReserved(uint256 id, address, uint128 amount, bytes32, bytes32 jobNonce) external returns (bytes32) {
        if (msg.sender != agreements) revert IBudgets.OnlyAgreements();
        ++payCalls;
        if (reenter) {
            reentered = true;
            (bool ok, bytes memory ret) = agreements.call(_reentry(id));
            reentrySucceeded = ok;
            if (ret.length >= 4) reentryError = bytes4(ret);
        }
        return keccak256(abi.encode(id, amount, jobNonce, payCalls));
    }

    function _reentry(uint256 id) internal view returns (bytes memory) {
        if (which == 0) return abi.encodeCall(IAgreements.collect, (argId, argAmount));
        if (which == 1) return abi.encodeCall(IAgreements.settle, (id));
        if (which == 2) return abi.encodeCall(IAgreements.pause, (argId));
        if (which == 3) return abi.encodeCall(IAgreements.resume, (argId));
        if (which == 4) return abi.encodeCall(IAgreements.end, (argId, argTime));
        if (which == 5) return abi.encodeCall(IAgreements.changeRate, (argId, argAmount, argTime));
        if (which == 6) return abi.encodeCall(IAgreements.cancelChange, (argId));
        if (which == 7) return abi.encodeCall(IAgreements.withdrawOffer, (argId));
        if (which == 8) return abi.encodeCall(IAgreements.accept, (argId, bytes32(uint256(argAmount))));
        return
            abi.encodeCall(IAgreements.offer, (id, address(this), argAmount, 1, 0, 0, 1, argTime, bytes32(uint256(1))));
    }
}
