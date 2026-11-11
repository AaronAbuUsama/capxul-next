// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IAgreements } from "../../../src/interfaces/IAgreements.sol";
import { IBudgets } from "../../../src/interfaces/IBudgets.sol";
import { IInstaller } from "../../../src/interfaces/IInstaller.sol";
import { IHats } from "../../../src/interfaces/external/IHats.sol";
import { IHatsSignerGate } from "../../../src/interfaces/external/IHatsSignerGate.sol";
import { ScenarioBase } from "./ScenarioBase.sol";
import { ScenarioRelay } from "./ScenarioRelay.sol";

/// @notice The money chapter's calls, args by the interface's parameter names (the TypeScript player encodes the
/// same file from the interface ABIs): the money install, Hats, Budgets, Agreements and token approvals.
abstract contract ScenarioMoneyCalls is ScenarioBase {
    /// @dev One money call, or `found == false`.
    function _moneyCall(
        string memory call,
        string memory p
    )
        internal
        view
        returns (bool found, address target, bytes memory data)
    {
        bytes32 c = keccak256(bytes(call));
        found = true;
        if (c == keccak256("Installer.deployMoney")) {
            (target, data) = _relayed(abi.encodeCall(IInstaller.deployMoney, (_moneyDeploy(string.concat(p, ".p")))));
        } else if (c == keccak256("Hats.mintHat")) {
            (target, data) = (_addr("Hats"), abi.encodeCall(IHats.mintHat, (_u(p, "hatId"), _a(p, "wearer"))));
        } else if (_startsWith(call, "Budgets.")) {
            (target, data) = (_contract("Budgets"), _budgets(c, p));
        } else if (_startsWith(call, "Agreements.")) {
            (target, data) = (_contract("Agreements"), _agreements(c, p));
        } else if (_isToken(call)) {
            (target, data) = _token(call, p);
        } else {
            found = false;
        }
    }

    function _budgets(bytes32 c, string memory p) internal view returns (bytes memory) {
        if (c == keccak256("Budgets.createChildBudget")) {
            return abi.encodeCall(IBudgets.createChildBudget, (_u(p, "parent"), uint128(_u(p, "amount")), _u(p, "hat")));
        }
        if (c == keccak256("Budgets.setAmount")) {
            return abi.encodeCall(IBudgets.setAmount, (_u(p, "id"), uint128(_u(p, "amount"))));
        }
        if (c == keccak256("Budgets.spend")) {
            return abi.encodeCall(
                IBudgets.spend,
                (
                    _u(p, "id"),
                    _a(p, "recipient"),
                    uint128(_u(p, "amount")),
                    uint16(_u(p, "kind")),
                    _b32(p, "documentHash"),
                    _b32(p, "jobNonce")
                )
            );
        }
        if (c == keccak256("Budgets.schedule")) {
            return abi.encodeCall(
                IBudgets.schedule,
                (
                    _u(p, "id"),
                    _a(p, "to"),
                    uint128(_u(p, "amount")),
                    uint16(_u(p, "kind")),
                    uint64(_u(p, "payAt")),
                    _b32(p, "documentHash"),
                    _b32(p, "jobNonce")
                )
            );
        }
        if (c == keccak256("Budgets.setAgreements")) {
            return abi.encodeCall(IBudgets.setAgreements, (_a(p, "agreements_")));
        }
        if (c == keccak256("Budgets.cancel")) return abi.encodeCall(IBudgets.cancel, (_u(p, "scheduledId")));
        if (c == keccak256("Budgets.execute")) return abi.encodeCall(IBudgets.execute, (_u(p, "scheduledId")));
        revert UnknownCall(string(abi.encodePacked(c)));
    }

    function _agreements(bytes32 c, string memory p) internal view returns (bytes memory) {
        if (c == keccak256("Agreements.offer")) {
            return abi.encodeCall(
                IAgreements.offer,
                (
                    _u(p, "budgetId"),
                    _a(p, "payee"),
                    uint128(_u(p, "rate")),
                    uint8(_u(p, "period")),
                    uint64(_u(p, "startsAt")),
                    uint64(_u(p, "endsAt")),
                    uint64(_u(p, "step")),
                    uint64(_u(p, "offerExpiresAt")),
                    _b32(p, "documentHash")
                )
            );
        }
        if (c == keccak256("Agreements.accept")) {
            return abi.encodeCall(IAgreements.accept, (_u(p, "id"), _b32(p, "termsHash")));
        }
        if (c == keccak256("Agreements.collect")) {
            return abi.encodeCall(IAgreements.collect, (_u(p, "id"), uint128(_u(p, "amount"))));
        }
        if (c == keccak256("Agreements.settle")) return abi.encodeCall(IAgreements.settle, (_u(p, "budgetId")));
        revert UnknownCall(string(abi.encodePacked(c)));
    }

    /// @dev `<token>.approve` and `<token>.transfer`, for a token in `tokens`.
    function _token(string memory call, string memory p) internal view returns (address target, bytes memory data) {
        string[] memory parts = vm.split(call, ".");
        target = _addr(parts[0]);
        if (keccak256(bytes(parts[1])) == keccak256("approve")) {
            data = abi.encodeCall(IERC20.approve, (_a(p, "spender"), _u(p, "value")));
        } else if (keccak256(bytes(parts[1])) == keccak256("transfer")) {
            data = abi.encodeCall(IERC20.transfer, (_a(p, "to"), _u(p, "value")));
        } else {
            revert UnknownCall(call);
        }
    }

    // ------------------------------------------------------------------ the money install's inputs

    function _moneyDeploy(string memory p) internal view returns (IInstaller.MoneyDeploy memory d) {
        d.safe = _a(p, "safe");
        d.founderSafe = _a(p, "founderSafe");
        d.coDirectors = _addrs(string.concat(p, ".coDirectors"));
        string memory t = string.concat(p, ".threshold");
        d.threshold = IHatsSignerGate.ThresholdConfig({
            thresholdType: IHatsSignerGate.TargetThresholdType(_u(t, "thresholdType")),
            min: uint120(_u(t, "min")),
            target: uint120(_u(t, "target"))
        });
        uint256 n = _count(string.concat(p, ".officers"));
        d.officers = new IInstaller.Officer[](n);
        for (uint256 i; i < n; ++i) {
            string memory o = string.concat(p, ".officers[", vm.toString(i), "]");
            d.officers[i] = IInstaller.Officer({ details: _str(o, "details"), maxSupply: uint32(_u(o, "maxSupply")) });
        }
        d.salt = _b32(p, "salt");
    }

    function _moneyInstall(string memory p) internal view returns (IInstaller.MoneyInstall memory m) {
        m.safe = _a(p, "safe");
        m.founderSafe = _a(p, "founderSafe");
        m.coDirectors = _addrs(string.concat(p, ".coDirectors"));
        m.deployment = _money();
        uint256 n = _count(string.concat(p, ".tokens"));
        m.tokens = new IInstaller.Token[](n);
        for (uint256 i; i < n; ++i) {
            string memory t = string.concat(p, ".tokens[", vm.toString(i), "]");
            m.tokens[i] = IInstaller.Token({
                token: _a(t, "token"),
                ceiling: uint128(_u(t, "ceiling")),
                budgetPeriod: uint8(_u(t, "budgetPeriod")),
                topAmount: uint128(_u(t, "topAmount")),
                topHat: _u(t, "topHat")
            });
        }
    }

    // ------------------------------------------------------------------ helpers

    /// @dev An `anyone` call the relay forwards and records.
    function _relayed(bytes memory data) internal view returns (address, bytes memory) {
        return (address(relay), abi.encodeCall(ScenarioRelay.relay, (_contract("Installer"), data)));
    }

    function _isToken(string memory call) internal view returns (bool) {
        return vm.keyExistsJson(json, string.concat(".tokens.", vm.split(call, ".")[0]));
    }

    function _startsWith(string memory s, string memory prefix) internal pure returns (bool) {
        return vm.indexOf(s, prefix) == 0;
    }
}
