// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";

import { IBudgets } from "../../../src/interfaces/IBudgets.sol";
import { MockHats } from "../../mocks/MockHats.sol";
import { BudgetsHandler } from "./BudgetsHandler.sol";

/// @notice Eve, and the hat wearers of each company acting where they have no hat, call every
/// guarded Budgets function on company A's and company B's budgets. A call is made only when the
/// "Who may act" table (spec/budgets.md, computed here from Hats directly, not from
/// `Budgets.authorised`) refuses it; if Budgets accepts it anyway, that is a breach (H2, H3, H4, B7).
/// Calls are wrapped in try/catch, so the handler never reverts.
contract BudgetsAttackerHandler is Test {
    uint8 internal constant MAX_DEPTH = 8;
    bytes32 internal constant DOC = keccak256("attacker document");

    BudgetsHandler public immutable handler;
    IBudgets public immutable budgets;
    MockHats public immutable hats;
    address internal immutable rolesA;
    bytes32 internal immutable roleKey;
    address[4] internal attackers;

    uint256 public breaches;
    uint256 public attempts;
    bytes4 public lastBreach;

    constructor(
        BudgetsHandler handler_,
        MockHats hats_,
        address rolesA_,
        bytes32 roleKey_,
        address[4] memory attackers_
    ) {
        handler = handler_;
        budgets = handler_.budgets();
        hats = hats_;
        rolesA = rolesA_;
        roleKey = roleKey_;
        attackers = attackers_;
    }

    /// @dev One refused call: `who` picks the attacker, `what` the function, `target` the budget.
    function attack(uint256 who, uint256 what, uint256 target) external {
        if (!handler.ready()) return;
        address attacker = attackers[who % attackers.length];
        uint256 id = _target(target);
        IBudgets.Budget memory b = budgets.budgetOf(id);
        bool mayAct = _authorised(id, attacker);
        bool mayManage = b.parent == 0 ? attacker == b.safe : _authorised(b.parent, attacker);
        bytes32 job = keccak256(abi.encode("attack", attempts));
        uint256 k = what % 12;

        bytes memory call;
        if (k == 0 && !mayAct) {
            call = abi.encodeCall(IBudgets.spend, (id, attacker, 1, 0, DOC, job));
        } else if (k == 1 && !mayAct) {
            call = abi.encodeCall(
                IBudgets.schedule, (id, attacker, 1, 0, uint64(block.timestamp + 1), DOC, bytes32("job"))
            );
        } else if (k == 2 && !mayManage) {
            call = abi.encodeCall(IBudgets.setAmount, (id, b.amount + 1));
        } else if (k == 3 && !mayManage) {
            call = b.closed ? abi.encodeCall(IBudgets.reopen, (id)) : abi.encodeCall(IBudgets.close, (id));
        } else if (k == 4 && !mayManage) {
            call = abi.encodeCall(IBudgets.setHat, (id, uint256(keccak256("eve's hat"))));
        } else if (k == 5 && !mayAct) {
            call = abi.encodeCall(IBudgets.createChildBudget, (id, 1, uint256(keccak256("eve's hat"))));
        } else if (k == 6) {
            call = abi.encodeCall(IBudgets.commit, (id, 1));
        } else if (k == 7) {
            call = abi.encodeCall(IBudgets.release, (id, 1));
        } else if (k == 8) {
            call = abi.encodeCall(IBudgets.payReserved, (id, attacker, 1, DOC, job));
        } else if (k == 9) {
            call = _cancel(attacker, target);
        } else if (k == 10) {
            call = abi.encodeCall(IBudgets.configure, (rolesA, roleKey));
        } else if (k == 11) {
            call = abi.encodeCall(IBudgets.setAgreements, (attacker));
        }
        if (call.length == 0) return;

        ++attempts;
        vm.prank(attacker);
        (bool ok,) = address(budgets).call(call);
        if (ok) {
            ++breaches;
            lastBreach = bytes4(call);
        }
    }

    function _cancel(address attacker, uint256 seed) internal view returns (bytes memory) {
        uint256 sid;
        uint256 n = handler.pendingLength();
        if (seed % 2 == 0 || n == 0) sid = handler.bScheduled();
        else sid = handler.pendingAt(seed % n).sid;
        if (_authorised(budgets.scheduledOf(sid).budgetId, attacker)) return "";
        return abi.encodeCall(IBudgets.cancel, (sid));
    }

    function _target(uint256 seed) internal view returns (uint256) {
        uint256 a = handler.idsLength();
        uint256 b = handler.bIdsLength();
        uint256 i = seed % (a + b);
        return i < a ? handler.ids(i) : handler.bIds(i - a);
    }

    /// @dev spec/budgets.md "Who may act", from Hats directly.
    function _authorised(uint256 id, address who) internal view returns (bool) {
        IBudgets.Budget memory b = budgets.budgetOf(id);
        if (who == b.safe) return true;
        for (uint256 i; i < MAX_DEPTH; ++i) {
            if (id == 0) break;
            b = budgets.budgetOf(id);
            if (hats.isWearerOfHat(who, b.hat) && hats.isInGoodStanding(who, b.hat)) return true;
            id = b.parent;
        }
        return false;
    }
}
