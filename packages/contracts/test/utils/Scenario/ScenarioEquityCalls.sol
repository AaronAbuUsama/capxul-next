// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICaptable } from "../../../src/interfaces/ICaptable.sol";
import { IInstaller } from "../../../src/interfaces/IInstaller.sol";
import { IOptions } from "../../../src/interfaces/IOptions.sol";
import { IRounds } from "../../../src/interfaces/IRounds.sol";
import { ScenarioMoneyCalls } from "./ScenarioMoneyCalls.sol";

/// @notice The equity chapters' calls: the equity install, Options, the Captable and Rounds.
abstract contract ScenarioEquityCalls is ScenarioMoneyCalls {
    function _equityCall(
        string memory call,
        string memory p
    )
        internal
        view
        returns (bool found, address target, bytes memory data)
    {
        bytes32 c = keccak256(bytes(call));
        found = true;
        if (c == keccak256("Installer.deployEquity")) {
            (target, data) = _relayed(abi.encodeCall(IInstaller.deployEquity, (_equityDeploy(string.concat(p, ".p")))));
        } else if (_startsWith(call, "Options.")) {
            (target, data) = (_equity().options, _options(c, p));
        } else if (_startsWith(call, "Captable.")) {
            (target, data) = (_equity().captable, _captable(c, p));
        } else if (_startsWith(call, "Rounds.")) {
            (target, data) = (_equity().rounds, _rounds(c, p));
        } else {
            found = false;
        }
    }

    function _options(bytes32 c, string memory p) internal view returns (bytes memory) {
        if (c == keccak256("Options.setPool")) return abi.encodeCall(IOptions.setPool, (uint128(_u(p, "amount"))));
        if (c == keccak256("Options.accept")) {
            return abi.encodeCall(IOptions.accept, (_u(p, "id"), _b32(p, "termsHash")));
        }
        if (c != keccak256("Options.grant")) revert UnknownCall("Options");
        return abi.encodeCall(
            IOptions.grant,
            (
                _a(p, "grantee"),
                uint128(_u(p, "shares")),
                _a(p, "strikeToken"),
                uint128(_u(p, "strikePrice")),
                uint64(_u(p, "start")),
                uint64(_u(p, "cliff")),
                uint64(_u(p, "end")),
                uint64(_u(p, "offerExpiresAt")),
                uint64(_u(p, "expiresAt")),
                uint32(_u(p, "exerciseWindowDays")),
                _b32(p, "documentHash")
            )
        );
    }

    function _captable(bytes32 c, string memory p) internal view returns (bytes memory) {
        if (c == keccak256("Captable.createClass")) {
            return abi.encodeCall(ICaptable.createClass, (_classParams(string.concat(p, ".p"))));
        }
        if (c == keccak256("Captable.setIssuerAllowance")) {
            return abi.encodeCall(
                ICaptable.setIssuerAllowance, (_a(p, "module"), uint8(_u(p, "classId")), uint128(_u(p, "amount")))
            );
        }
        if (c != keccak256("Captable.consentToTransfer")) revert UnknownCall("Captable");
        return abi.encodeCall(
            ICaptable.consentToTransfer,
            (uint8(_u(p, "classId")), _a(p, "to"), uint128(_u(p, "amount")), _b32(p, "reason"))
        );
    }

    function _rounds(bytes32 c, string memory p) internal view returns (bytes memory) {
        if (c == keccak256("Rounds.createSafeRound")) {
            return abi.encodeCall(
                IRounds.createSafeRound,
                (
                    _a(p, "token"),
                    uint128(_u(p, "valuationCap")),
                    uint16(_u(p, "discountBps")),
                    uint64(_u(p, "closesAt")),
                    _b32(p, "documentHash")
                )
            );
        }
        if (c == keccak256("Rounds.createPricedRound")) {
            return abi.encodeCall(
                IRounds.createPricedRound,
                (
                    uint8(_u(p, "classId")),
                    _a(p, "token"),
                    uint128(_u(p, "price")),
                    uint128(_u(p, "maxShares")),
                    uint64(_u(p, "payBy")),
                    _b32(p, "documentHash")
                )
            );
        }
        if (c == keccak256("Rounds.inviteSafe") || c == keccak256("Rounds.invite")) {
            return abi.encodeWithSelector(
                c == keccak256("Rounds.invite") ? IRounds.invite.selector : IRounds.inviteSafe.selector,
                _u(p, "roundId"),
                _a(p, "investor"),
                uint128(_u(p, "maxAmount"))
            );
        }
        if (c == keccak256("Rounds.signSafe") || c == keccak256("Rounds.commit")) {
            return abi.encodeWithSelector(
                c == keccak256("Rounds.commit") ? IRounds.commit.selector : IRounds.signSafe.selector,
                _u(p, "roundId"),
                uint128(_u(p, "amount")),
                _b32(p, "documentHash")
            );
        }
        if (c == keccak256("Rounds.convertSafes")) {
            return abi.encodeCall(
                IRounds.convertSafes,
                (_uints(string.concat(p, ".noteIds")), _u(p, "pricedRoundId"), _u(p, "companyCapitalization"))
            );
        }
        if (c == keccak256("Rounds.allocate")) {
            return abi.encodeCall(IRounds.allocate, (_u(p, "roundId"), _a(p, "investor"), uint128(_u(p, "shares"))));
        }
        if (c == keccak256("Rounds.close")) {
            return abi.encodeCall(IRounds.close, (_u(p, "roundId"), _u(p, "deemedOutstandingA")));
        }
        if (c == keccak256("Rounds.closeSafeRound")) return abi.encodeCall(IRounds.closeSafeRound, (_u(p, "roundId")));
        if (c == keccak256("Rounds.pay")) return abi.encodeCall(IRounds.pay, (_u(p, "roundId")));
        revert UnknownCall("Rounds");
    }

    // ------------------------------------------------------------------ inputs

    function _equityDeploy(string memory p) internal view returns (IInstaller.EquityDeploy memory d) {
        d.safe = _a(p, "safe");
        d.money = _money();
        d.name = _str(p, "name");
        uint256 n = _count(string.concat(p, ".initialClasses"));
        d.initialClasses = new ICaptable.ClassParams[](n);
        for (uint256 i; i < n; ++i) {
            d.initialClasses[i] = _classParams(string.concat(p, ".initialClasses[", vm.toString(i), "]"));
        }
        d.poolClassId = uint8(_u(p, "poolClassId"));
        string memory g = string.concat(p, ".governor");
        d.governor = IInstaller.GovernorSettings({
            votingDelay: uint48(_u(g, "votingDelay")),
            votingPeriod: uint32(_u(g, "votingPeriod")),
            proposalThreshold: _u(g, "proposalThreshold"),
            quorumNumerator: _u(g, "quorumNumerator")
        });
    }

    function _equityInstall(string memory p) internal view returns (IInstaller.EquityInstall memory e) {
        e.safe = _a(p, "safe");
        e.founderSafe = _a(p, "founderSafe");
        e.money = _money();
        e.equity = _equity();
        uint256 n = _count(string.concat(p, ".founders"));
        e.founders = new IInstaller.FounderShares[](n);
        for (uint256 i; i < n; ++i) {
            string memory f = string.concat(p, ".founders[", vm.toString(i), "]");
            e.founders[i] = IInstaller.FounderShares({
                shareholder: _a(f, "shareholder"),
                classId: uint8(_u(f, "classId")),
                amount: uint128(_u(f, "amount")),
                start: uint64(_u(f, "start")),
                cliff: uint64(_u(f, "cliff")),
                end: uint64(_u(f, "end")),
                accelerateOnExit: _bool(f, "accelerateOnExit"),
                documentHash: _b32(f, "documentHash")
            });
        }
        e.optionPool = uint128(_u(p, "optionPool"));
    }

    function _classParams(string memory p) internal view returns (ICaptable.ClassParams memory) {
        return ICaptable.ClassParams({
            name: _str(p, "name"),
            ticker: _str(p, "ticker"),
            weight: uint16(_u(p, "weight")),
            convertsInto: uint8(_u(p, "convertsInto")),
            rule: ICaptable.TransferRule(_u(p, "rule")),
            customRule: _a(p, "customRule"),
            authorised: uint128(_u(p, "authorised")),
            originalIssuePrice: uint128(_u(p, "originalIssuePrice")),
            conversionFloorPrice: uint128(_u(p, "conversionFloorPrice")),
            preferenceMultipleBps: uint128(_u(p, "preferenceMultipleBps")),
            participating: _bool(p, "participating"),
            seniority: uint8(_u(p, "seniority")),
            termsHash: _b32(p, "termsHash")
        });
    }
}
