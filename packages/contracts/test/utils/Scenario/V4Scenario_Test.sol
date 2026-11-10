// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { ICaptable } from "../../../src/interfaces/ICaptable.sol";
import { IOptions } from "../../../src/interfaces/IOptions.sol";
import { IVesting } from "../../../src/interfaces/IVesting.sol";
import { ScenarioMoneyChecks } from "./ScenarioMoneyChecks.sol";

/// @notice The v4 scenario runner: `Scenario_Test` plus the money and equity calls, Board batches and votes, and
/// a play that checks every checkpoint key and re-checks the invariants. `Scenario_Test.test_Play` also runs and
/// checks only the Safes: its `_checkpoint` is not virtual, so `test_PlayAndCheck` plays the same timeline with
/// every check.
///
/// Equity keys, exact share counts and price units:
///
/// - `shares.<address>.<class>`: the class token balance;
/// - `locked.<address>.<class>`: `Vesting.lockedOf` at the checkpoint;
/// - `classes.<class>.<field>`: totalSupply, authorised, conversionPrice (`conversionPriceAt` now);
/// - `options.<field>`: pool, allocated;
/// - `closedForExit`: the Captable's flag.
///
/// Once equity is installed every checkpoint also re-checks E1 (each class's supply plus convertible reserve is
/// within its authorised) and E3 (each actor's Captable votes equal the per-class formula; the company Safe's are 0).
abstract contract V4Scenario_Test is ScenarioMoneyChecks {
    function test_PlayAndCheck() external {
        vm.pauseGasMetering();
        uint256 events = _count(".events");
        uint256 checkpoints = _count(".checkpoints");
        uint256 e;
        uint256 c;
        while (e < events || c < checkpoints) {
            string memory ep = string.concat(".events[", vm.toString(e), "]");
            string memory cp = string.concat(".checkpoints[", vm.toString(c), "]");
            bool eventNext = e < events && (c == checkpoints || _at(ep) <= _at(cp));
            vm.warp(_at(eventNext ? ep : cp));
            // One call frame per step, so the memory each step's reads of the file take is freed after it.
            if (eventNext) {
                this.playEvent(ep);
                ++e;
            } else {
                this.checkCheckpoint(cp);
                ++c;
            }
        }
    }

    /// @dev One event, in its own call frame.
    function playEvent(string memory ep) external {
        _event(ep);
    }

    /// @dev One checkpoint: the Safes, every money and equity key, then the invariants.
    function checkCheckpoint(string memory cp) external view {
        string memory label = vm.parseJsonString(json, string.concat(cp, ".name"));
        _checkpoint(cp);
        _checkMoney(cp, label);
        _checkEquity(cp, label);
        _moneyInvariants(label);
        _equityInvariants(label);
    }

    // ------------------------------------------------------------------ equity keys

    function _checkEquity(string memory cp, string memory label) internal view {
        _checkByClass(string.concat(cp, ".expect.shares"), label, true);
        _checkByClass(string.concat(cp, ".expect.locked"), label, false);
        _checkClasses(string.concat(cp, ".expect.classes"), label);
        string memory o = string.concat(cp, ".expect.options");
        if (vm.keyExistsJson(json, string.concat(o, ".pool"))) {
            assertEq(IOptions(_equity().options).pool(), _u(o, "pool"), string.concat(label, ": option pool"));
        }
        if (vm.keyExistsJson(json, string.concat(o, ".allocated"))) {
            assertEq(IOptions(_equity().options).allocated(), _u(o, "allocated"), string.concat(label, ": allocated"));
        }
        string memory closed = string.concat(cp, ".expect.closedForExit");
        if (vm.keyExistsJson(json, closed)) {
            assertEq(
                ICaptable(_equity().captable).closedForExit(),
                vm.parseJsonBool(json, closed),
                string.concat(label, ": closed for exit")
            );
        }
    }

    /// @dev `<address>.<class>`: the balance (`shares`) or what Vesting locks now (`locked`).
    function _checkByClass(string memory e, string memory label, bool balances) internal view {
        if (!vm.keyExistsJson(json, e)) return;
        ICaptable captable = ICaptable(_equity().captable);
        string[] memory who = vm.parseJsonKeys(json, e);
        for (uint256 i; i < who.length; ++i) {
            string memory q = string.concat(e, ".", who[i]);
            string[] memory classes = vm.parseJsonKeys(json, q);
            for (uint256 j; j < classes.length; ++j) {
                uint8 classId = uint8(_named(classes[j]));
                address account = _addr(who[i]);
                uint256 actual = balances
                    ? captable.getClass(classId).token.balanceOf(account)
                    : IVesting(_contract("Vesting"))
                        .lockedOf(address(captable), classId, account, uint64(block.timestamp));
                _assertAmount(
                    actual,
                    string.concat(q, ".", classes[j]),
                    string.concat(label, ": ", who[i], balances ? " holds " : " has locked ", classes[j])
                );
            }
        }
    }

    function _checkClasses(string memory e, string memory label) internal view {
        if (!vm.keyExistsJson(json, e)) return;
        ICaptable captable = ICaptable(_equity().captable);
        string[] memory classes = vm.parseJsonKeys(json, e);
        for (uint256 i; i < classes.length; ++i) {
            uint8 classId = uint8(_named(classes[i]));
            ICaptable.Class memory k = captable.getClass(classId);
            string memory q = string.concat(e, ".", classes[i]);
            string[] memory fields = vm.parseJsonKeys(json, q);
            for (uint256 j; j < fields.length; ++j) {
                bytes32 f = keccak256(bytes(fields[j]));
                uint256 actual;
                if (f == keccak256("totalSupply")) {
                    actual = k.token.totalSupply();
                } else if (f == keccak256("authorised")) {
                    actual = k.authorised;
                } else if (f == keccak256("conversionPrice")) {
                    actual = captable.conversionPriceAt(classId, block.timestamp);
                } else {
                    revert UnknownName(fields[j]);
                }
                assertEq(actual, _u(q, fields[j]), string.concat(label, ": ", classes[i], " ", fields[j]));
            }
        }
    }

    // ------------------------------------------------------------------ E1, E3

    function _equityInvariants(string memory label) internal view {
        if (!_hasEquity()) return;
        ICaptable captable = ICaptable(_equity().captable);
        uint8 n = captable.numberOfClasses();
        for (uint8 c; c < n; ++c) {
            ICaptable.Class memory k = captable.getClass(c);
            assertLe(
                k.token.totalSupply() + captable.convertibleReserved(c),
                k.authorised,
                string.concat(label, ": E1 class ", vm.toString(c))
            );
        }
        string[] memory actors = vm.parseJsonKeys(json, ".actors");
        for (uint256 i; i < actors.length; ++i) {
            bytes32 role = keccak256(bytes(_role(actors[i])));
            if (role == keccak256("companies-house") || role == keccak256("anyone")) continue;
            address account = _identity(actors[i]);
            uint256 expected = role == keccak256("company") ? 0 : _votesByClass(captable, account, n);
            assertEq(captable.getVotes(account), expected, string.concat(label, ": E3 ", actors[i]));
        }
    }

    function _votesByClass(ICaptable captable, address account, uint8 n) internal view returns (uint256 votes) {
        for (uint8 c; c < n; ++c) {
            ICaptable.Class memory k = captable.getClass(c);
            if (k.weight == 0) continue;
            uint256 v = uint256(k.weight) * k.token.getVotes(account);
            votes += k.originalIssuePrice == 0
                ? v
                : Math.mulDiv(v, k.originalIssuePrice, captable.conversionPriceAt(c, block.timestamp));
        }
    }
}
