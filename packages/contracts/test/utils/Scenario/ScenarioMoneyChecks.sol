// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IAgreements } from "../../../src/interfaces/IAgreements.sol";
import { IBudgets } from "../../../src/interfaces/IBudgets.sol";
import { IHats } from "../../../src/interfaces/external/IHats.sol";
import { ScenarioBatches } from "./ScenarioBatches.sol";

/// @notice A checkpoint's money keys, each value exact token units unless it is `{ "about", "within" }`:
///
/// - `Budgets.<budget>.<field>`: amount, childrenAmount, ownSpent, ownCommitted, spent, committed (effective
///   values, as `budgetOf` returns them), left (`leftOf`), parent, hat;
/// - `balances.<address>.<token>`;
/// - `Agreements.<agreement>.<field>`: collected, reserved, available (`availableOf`), earned (`earnedOf`);
/// - `Scheduled.<payment>.state`: Pending, Cancelled or Paid;
/// - `hats.<hat>.<address>`: whether the address wears the hat.
///
/// And at every checkpoint, over the whole company, the money rules (spec/scenario-player.md): B1, B2, B6 on
/// every budget, A1 on every agreement, A2 on every budget (open agreements' reservations plus pending scheduled
/// payments equal `ownCommitted`), and P2 (Payments' balance of each token is what it was at setup).
abstract contract ScenarioMoneyChecks is ScenarioBatches {
    /// @dev Calendar.SCALE: 12 * LCM_DAYS * DAY (spec/calendar.md).
    uint256 internal constant SCALE = 12 * 377_580 * 86_400;

    function _checkMoney(string memory cp, string memory label) internal view {
        _checkBudgets(string.concat(cp, ".expect.Budgets"), label);
        _checkBalances(string.concat(cp, ".expect.balances"), label);
        _checkAgreements(string.concat(cp, ".expect.Agreements"), label);
        _checkScheduled(string.concat(cp, ".expect.Scheduled"), label);
        _checkHats(string.concat(cp, ".expect.hats"), label);
    }

    function _checkBudgets(string memory e, string memory label) internal view {
        if (!vm.keyExistsJson(json, e)) return;
        IBudgets budgets = IBudgets(_contract("Budgets"));
        string[] memory names = vm.parseJsonKeys(json, e);
        for (uint256 i; i < names.length; ++i) {
            uint256 id = _named(names[i]);
            IBudgets.Budget memory b = budgets.budgetOf(id);
            string memory q = string.concat(e, ".", names[i]);
            string[] memory fields = vm.parseJsonKeys(json, q);
            for (uint256 j; j < fields.length; ++j) {
                uint256 actual = _budgetField(budgets, id, b, fields[j]);
                assertEq(actual, _u(q, fields[j]), string.concat(label, ": ", names[i], " ", fields[j]));
            }
        }
    }

    function _budgetField(
        IBudgets budgets,
        uint256 id,
        IBudgets.Budget memory b,
        string memory field
    )
        internal
        view
        returns (uint256)
    {
        bytes32 f = keccak256(bytes(field));
        if (f == keccak256("amount")) return b.amount;
        if (f == keccak256("childrenAmount")) return b.childrenAmount;
        if (f == keccak256("ownSpent")) return b.ownSpent;
        if (f == keccak256("ownCommitted")) return b.ownCommitted;
        if (f == keccak256("spent")) return b.spent;
        if (f == keccak256("committed")) return b.committed;
        if (f == keccak256("left")) return budgets.leftOf(id);
        if (f == keccak256("parent")) return b.parent;
        if (f == keccak256("hat")) return b.hat;
        revert UnknownName(field);
    }

    function _checkBalances(string memory e, string memory label) internal view {
        if (!vm.keyExistsJson(json, e)) return;
        string[] memory who = vm.parseJsonKeys(json, e);
        for (uint256 i; i < who.length; ++i) {
            string memory q = string.concat(e, ".", who[i]);
            string[] memory names = vm.parseJsonKeys(json, q);
            for (uint256 j; j < names.length; ++j) {
                uint256 actual = IERC20(_addr(names[j])).balanceOf(_addr(who[i]));
                _assertAmount(
                    actual, string.concat(q, ".", names[j]), string.concat(label, ": ", who[i], " ", names[j])
                );
            }
        }
    }

    function _checkAgreements(string memory e, string memory label) internal view {
        if (!vm.keyExistsJson(json, e)) return;
        IAgreements agreements = IAgreements(_contract("Agreements"));
        string[] memory names = vm.parseJsonKeys(json, e);
        for (uint256 i; i < names.length; ++i) {
            uint256 id = _named(names[i]);
            IAgreements.Agreement memory a = agreements.agreementOf(id);
            string memory q = string.concat(e, ".", names[i]);
            string[] memory fields = vm.parseJsonKeys(json, q);
            for (uint256 j; j < fields.length; ++j) {
                uint256 actual = _agreementField(agreements, id, a, fields[j]);
                assertEq(actual, _u(q, fields[j]), string.concat(label, ": ", names[i], " ", fields[j]));
            }
        }
    }

    function _agreementField(
        IAgreements agreements,
        uint256 id,
        IAgreements.Agreement memory a,
        string memory field
    )
        internal
        view
        returns (uint256)
    {
        bytes32 f = keccak256(bytes(field));
        if (f == keccak256("collected")) return a.collected;
        if (f == keccak256("reserved")) return a.reserved;
        if (f == keccak256("available")) return agreements.availableOf(id);
        if (f == keccak256("earned")) return agreements.earnedOf(id);
        revert UnknownName(field);
    }

    function _checkScheduled(string memory e, string memory label) internal view {
        if (!vm.keyExistsJson(json, e)) return;
        string[] memory names = vm.parseJsonKeys(json, e);
        for (uint256 i; i < names.length; ++i) {
            IBudgets.ScheduleState state = IBudgets(_contract("Budgets")).scheduledOf(_named(names[i])).state;
            bytes32 want = keccak256(bytes(_str(string.concat(e, ".", names[i]), "state")));
            IBudgets.ScheduleState expected = want == keccak256("Pending")
                ? IBudgets.ScheduleState.Pending
                : want == keccak256("Cancelled")
                    ? IBudgets.ScheduleState.Cancelled
                    : want == keccak256("Paid") ? IBudgets.ScheduleState.Paid : IBudgets.ScheduleState.None;
            assertEq(uint8(state), uint8(expected), string.concat(label, ": ", names[i], " state"));
        }
    }

    function _checkHats(string memory e, string memory label) internal view {
        if (!vm.keyExistsJson(json, e)) return;
        string[] memory hats = vm.parseJsonKeys(json, e);
        for (uint256 i; i < hats.length; ++i) {
            string memory q = string.concat(e, ".", hats[i]);
            string[] memory who = vm.parseJsonKeys(json, q);
            for (uint256 j; j < who.length; ++j) {
                assertEq(
                    IHats(_addr("Hats")).isWearerOfHat(_addr(who[j]), _named(hats[i])),
                    vm.parseJsonBool(json, string.concat(q, "['", who[j], "']")),
                    string.concat(label, ": ", who[j], " wears ", hats[i])
                );
            }
        }
    }

    /// @dev Exact units, or `{ "about": units, "within": units }`.
    function _assertAmount(uint256 actual, string memory q, string memory label) internal view {
        try vm.parseJsonString(json, q) returns (string memory exact) {
            assertEq(actual, _uint(exact), label);
        } catch {
            assertApproxEqAbs(actual, _u(q, "about"), _u(q, "within"), label);
        }
    }

    // ------------------------------------------------------------------ B1, B2, B6, A1, A2, P2

    function _moneyInvariants(string memory label) internal view {
        if (contractAt[keccak256("Budgets")] == address(0)) return;
        IBudgets budgets = IBudgets(_contract("Budgets"));
        address company = _company();
        (address roles,) = budgets.configs(company);
        if (roles == address(0)) return;
        uint256 n = budgets.budgetCount();
        for (uint256 id = 1; id <= n; ++id) {
            IBudgets.Budget memory b = budgets.budgetOf(id);
            if (b.safe != company) continue;
            string memory at = string.concat(label, ": budget ", vm.toString(id), " ");
            assertLe(uint256(b.ownSpent) + b.ownCommitted + b.childrenAmount, b.amount, string.concat(at, "B1"));
            uint256[] memory children = budgets.childrenOf(id);
            uint256 amounts;
            uint256 spent;
            uint256 committed;
            for (uint256 k; k < children.length; ++k) {
                IBudgets.Budget memory child = budgets.budgetOf(children[k]);
                amounts += child.amount;
                spent += child.spent;
                committed += child.committed;
            }
            assertEq(b.childrenAmount, amounts, string.concat(at, "B6 sum"));
            assertLe(b.childrenAmount, b.amount, string.concat(at, "B6"));
            assertEq(b.spent, uint256(b.ownSpent) + spent, string.concat(at, "B2 spent"));
            assertEq(b.committed, uint256(b.ownCommitted) + committed, string.concat(at, "B2 committed"));
            assertEq(b.ownCommitted, _reservedIn(id) + _pendingIn(id), string.concat(at, "A2"));
        }
        _a1(company, label);
        address payments = _contract("Payments");
        for (uint256 i; i < tokens.length; ++i) {
            assertEq(IERC20(tokens[i]).balanceOf(payments), paymentsAtSetup[tokens[i]], string.concat(label, ": P2"));
        }
    }

    function _a1(address company, string memory label) internal view {
        IAgreements agreements = IAgreements(_contract("Agreements"));
        uint256 m = agreements.agreementCount();
        for (uint256 id = 1; id <= m; ++id) {
            IAgreements.Agreement memory a = agreements.agreementOf(id);
            if (a.safe != company) continue;
            string memory at = string.concat(label, ": agreement ", vm.toString(id), " A1");
            assertLe(uint256(a.collected) * SCALE, a.releasedScaled, at);
            assertLe(a.releasedScaled, a.earnedScaled, at);
        }
    }

    /// @dev The reservations of a budget's open, unclosed agreements.
    function _reservedIn(uint256 budgetId) internal view returns (uint256 sum) {
        IAgreements agreements = IAgreements(_contract("Agreements"));
        uint256[] memory open = agreements.openOf(budgetId);
        for (uint256 k; k < open.length; ++k) {
            IAgreements.Agreement memory a = agreements.agreementOf(open[k]);
            if (!a.closed) sum += a.reserved;
        }
    }

    function _pendingIn(uint256 budgetId) internal view returns (uint256 sum) {
        IBudgets budgets = IBudgets(_contract("Budgets"));
        uint256 n = budgets.scheduledCount();
        for (uint256 id = 1; id <= n; ++id) {
            IBudgets.Scheduled memory s = budgets.scheduledOf(id);
            if (s.budgetId == budgetId && s.state == IBudgets.ScheduleState.Pending) sum += s.amount;
        }
    }
}
