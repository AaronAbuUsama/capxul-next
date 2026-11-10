// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IBudgets } from "../interfaces/IBudgets.sol";
import { IInstaller } from "../interfaces/IInstaller.sol";
import { IHats } from "../interfaces/external/IHats.sol";
import { IHatsSignerGate } from "../interfaces/external/IHatsSignerGate.sol";
import { IRoles } from "../interfaces/external/IRoles.sol";
import { ISafe } from "../interfaces/external/ISafe.sol";
import { PayoutScope } from "../libraries/PayoutScope.sol";
import { InstallerBase } from "./InstallerBase.sol";

/// @notice Reads of the real Gate, Safe and Roles the Installer needs beyond `src/interfaces/external`.
interface IInstallerReads {
    function setTransactionUnwrapper(address target, bytes4 selector, address adapter) external;
    function thresholdConfig() external view returns (IHatsSignerGate.ThresholdConfig memory);
    function changeThreshold(uint256 threshold) external;
    function getThreshold() external view returns (uint256);
    function allowances(bytes32 key)
        external
        view
        returns (uint128 refill, uint128 maxRefill, uint64 period, uint128 balance, uint64 timestamp);
}

/// @title InstallerMoney
/// @notice The money install of spec/installer.md: `deployMoney` (step 1), `buildMoney` (step 2) and the later
/// `buildAddToken` and `buildSetCeiling` (J12). The Installer wears the two top hats only inside `deployMoney` and
/// keeps no authority afterwards (I2).
abstract contract InstallerMoney is InstallerBase {
    // forge-lint: disable-start(calls-loop, require-revert-in-loop, reentrancy-events, unused-return, uninitialized-local, block-timestamp, divide-before-multiply, unsafe-typecast)
    // The Installer is a one-shot deploy and view helper: it holds no funds and no authority (I2), so its loops of
    // calls, its events after calls, and its refusals inside input loops cannot be reentered for gain. Loop counters
    // and flags start at zero and false. It compares times because a term or period is a time. Casts are of values
    // bounded by the caller's own list lengths or by Roles' own types.
    /// @dev Safe's fallback handler slot (unchanged in 1.5.0), `keccak256("fallback_manager.handler.address")`.
    address private constant MULTI_SEND_CALL_ONLY = 0x9641d764fc13c8B624c04430C7356C1C7C8102e2;
    uint256 private constant FALLBACK_HANDLER_SLOT = 0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5;

    /// @inheritdoc IInstaller
    function deployMoney(MoneyDeploy calldata p) external returns (MoneyDeployment memory d) {
        _requireContract(p.safe, InstallRefusal.SafeInvalid);
        _checkFounders(p.safe, p.founderSafe, p.coDirectors);
        _checkThreshold(p.threshold, p.coDirectors.length);
        _boardTree(p, d);
        _shareholdersTree(p, d);
        d.roles = _module(
            rolesMastercopy, abi.encodeCall(IRoles.setUp, (abi.encode(p.safe, p.safe, p.safe))), uint256(p.salt)
        );
        d.gate = _module(gateImplementation, _gateInit(p, d), uint256(p.salt));
        emit MoneyDeployed(p.safe, p.founderSafe, d);
    }

    /// @inheritdoc IInstaller
    function buildMoney(MoneyInstall calldata p) external view returns (Call[] memory calls) {
        _requireContract(p.safe, InstallRefusal.SafeInvalid);
        _checkFounders(p.safe, p.founderSafe, p.coDirectors);
        _checkDeployment(p.safe, p.deployment.roles, p.deployment.gate);
        _checkDirectors(p.deployment.directorHat, p.founderSafe, p.coDirectors);
        // The Gate may have been deployed for another list of Directors: with fewer owners than its minimum it
        // refuses every Safe transaction (`ThresholdTooLow`, HatsSignerGate.sol:484) and the Board could never sign.
        _checkThreshold(IInstallerReads(p.deployment.gate).thresholdConfig(), p.coDirectors.length);
        _checkTokens(p.tokens);

        address[] memory modules = _modulesOf(p.safe);
        address[] memory owners = ISafe(p.safe).getOwners();
        calls = new Call[](16 + modules.length + 6 * p.tokens.length + p.coDirectors.length + owners.length);
        uint256 n = _disableModules(calls, 0, p.safe, modules);
        n = _payoutRole(calls, n, p);
        // The Gate is the only module and the guard (Safe reads the guard once before the batch).
        calls[n++] = _call(p.safe, abi.encodeCall(ISafe.enableModule, (p.deployment.gate)));
        calls[n++] = _call(p.safe, abi.encodeCall(ISafe.setGuard, (p.deployment.gate)));
        n = _claimAndRemove(calls, n, p, owners);
        assembly ("memory-safe") {
            mstore(calls, n)
        }
    }

    /// @inheritdoc IInstaller
    function buildAddToken(AddToken calldata p) external view returns (Call[] memory calls) {
        _requireContract(p.safe, InstallRefusal.SafeInvalid);
        _checkRoles(p.safe, p.roles);
        Token[] memory all = new Token[](p.existing.length + 1);
        address[] memory tokens = new address[](all.length);
        for (uint256 i; i < p.existing.length; ++i) {
            all[i] = p.existing[i];
            tokens[i] = p.existing[i].token;
        }
        all[p.existing.length] = p.token;
        tokens[p.existing.length] = p.token.token;
        _checkTokens(all);
        // A token that already pays on the role keeps its allowance (and this period's spend): only
        // `buildSetCeiling` resizes it, so adding it again is a duplicate even when `existing` leaves it out.
        (uint128 refill, uint128 maxRefill,,,) =
            IInstallerReads(p.roles).allowances(PayoutScope.allowanceKey(p.token.token));
        if (refill != 0 || maxRefill != 0) revert InvalidInstall(InstallRefusal.DuplicateToken);

        calls = new Call[](6);
        (calls[0], calls[1]) = PayoutScope.approveScope(p.roles, p.token.token, payments);
        (calls[2], calls[3]) = PayoutScope.sendScope(p.roles, tokens, payments);
        calls[4] = PayoutScope.allowance(
            p.roles, p.token.token, p.token.ceiling, PayoutScope.periodSeconds(p.token.budgetPeriod)
        );
        calls[5] = _topBudget(p.token);
    }

    /// @inheritdoc IInstaller
    function buildSetCeiling(SetCeiling calldata p) external view returns (Call[] memory calls) {
        _requireContract(p.safe, InstallRefusal.SafeInvalid);
        _checkRoles(p.safe, p.roles);
        bytes32 key = PayoutScope.allowanceKey(p.token);
        (uint128 refill, uint128 maxRefill, uint64 period, uint128 balance, uint64 stamp) =
            IInstallerReads(p.roles).allowances(key);
        if (maxRefill == 0 && refill == 0) revert InvalidInstall(InstallRefusal.TokenUnknown);
        // What Roles counts as the balance now, so this period's spend is kept and a due refill is not lost.
        if (period != 0 && block.timestamp >= uint256(stamp) + period) {
            uint256 intervals = (block.timestamp - stamp) / period;
            if (balance < maxRefill) {
                balance = uint128(_min(uint256(balance) + uint256(refill) * intervals, maxRefill));
            }
            stamp = uint64(stamp + intervals * period);
        }
        uint128 spent = maxRefill > balance ? maxRefill - balance : 0;
        uint128 next = spent >= p.ceiling ? 0 : p.ceiling - spent;
        calls = new Call[](1);
        calls[0] = _call(p.roles, abi.encodeCall(IRoles.setAllowance, (key, next, p.ceiling, p.ceiling, period, stamp)));
    }

    // ------------------------------------------------------------------ deployMoney

    function _boardTree(MoneyDeploy calldata p, MoneyDeployment memory d) private {
        IHats h = IHats(hats);
        // Officers are direct children of the top hat, so only the Safe administers them (R1 R-4).
        d.boardTopHat = h.mintTopHat(address(this), "Board", "");
        d.officerHats = new uint256[](p.officers.length);
        for (uint256 i; i < p.officers.length; ++i) {
            d.officerHats[i] =
                h.createHat(d.boardTopHat, p.officers[i].details, p.officers[i].maxSupply, p.safe, p.safe, true, "");
        }
        h.transferHat(d.boardTopHat, address(this), p.safe);
    }

    function _shareholdersTree(MoneyDeploy calldata p, MoneyDeployment memory d) private {
        IHats h = IHats(hats);
        d.shareholdersTopHat = h.mintTopHat(address(this), "Shareholders", "");
        // Mutable, so Elections can be attached later; the company Safe is never its admin, eligibility or toggle.
        uint32 seats = uint32(1 + p.coDirectors.length);
        d.directorHat = h.createHat(d.shareholdersTopHat, "Director", seats, p.founderSafe, p.founderSafe, true, "");
        h.mintHat(d.directorHat, p.founderSafe);
        for (uint256 i; i < p.coDirectors.length; ++i) {
            h.mintHat(d.directorHat, p.coDirectors[i]);
        }
        h.transferHat(d.shareholdersTopHat, address(this), p.founderSafe);
    }

    function _gateInit(MoneyDeploy calldata p, MoneyDeployment memory d) private view returns (bytes memory) {
        uint256[] memory signerHats = new uint256[](1);
        signerHats[0] = d.directorHat;
        address[] memory gateModules = new address[](1);
        gateModules[0] = d.roles;
        return abi.encodeCall(
            IHatsSignerGate.setUp,
            (abi.encode(
                    IHatsSignerGate.SetupParams({
                        ownerHat: d.shareholdersTopHat,
                        signerHats: signerHats,
                        safe: p.safe,
                        thresholdConfig: p.threshold,
                        locked: false,
                        claimableFor: true,
                        implementation: gateImplementation,
                        hsgGuard: address(0),
                        hsgModules: gateModules
                    })
                ))
        );
    }

    // ------------------------------------------------------------------ buildMoney

    /// @dev Every module the Safe has now goes, head first (so `prev` is always the sentinel); a 4337 module as
    /// fallback handler gives way to the compatibility handler.
    function _disableModules(
        Call[] memory calls,
        uint256 n,
        address safe,
        address[] memory modules
    )
        private
        view
        returns (uint256)
    {
        for (uint256 i; i < modules.length; ++i) {
            calls[n++] = _call(safe, abi.encodeCall(ISafe.disableModule, (SENTINEL, modules[i])));
        }
        bytes memory slot = ISafe(safe).getStorageAt(FALLBACK_HANDLER_SLOT, 1);
        if (address(uint160(uint256(bytes32(slot)))) == safe4337Module) {
            calls[n++] = _call(safe, abi.encodeCall(ISafe.setFallbackHandler, (fallbackHandler)));
        }
        return n;
    }

    /// @dev Roles sends through the Gate; Budgets alone holds the payout role, scoped per token, with one allowance
    /// per token; then Budgets learns Roles (it checks the target) and each top budget is created.
    function _payoutRole(Call[] memory calls, uint256 n, MoneyInstall calldata p) private view returns (uint256) {
        address roles = p.deployment.roles;
        calls[n++] = _call(roles, abi.encodeCall(IRoles.setTarget, (p.deployment.gate)));
        calls[n++] = _call(
            roles,
            abi.encodeCall(
                IInstallerReads.setTransactionUnwrapper,
                (MULTI_SEND_CALL_ONLY, bytes4(keccak256("multiSend(bytes)")), multisendUnwrapper)
            )
        );
        bytes32[] memory keys = new bytes32[](1);
        keys[0] = PAYOUT_ROLE_KEY;
        bool[] memory on = new bool[](1);
        on[0] = true;
        calls[n++] = _call(roles, abi.encodeCall(IRoles.assignRoles, (budgets, keys, on)));
        address[] memory tokens = new address[](p.tokens.length);
        for (uint256 i; i < p.tokens.length; ++i) {
            tokens[i] = p.tokens[i].token;
            (calls[n], calls[n + 1]) = PayoutScope.approveScope(roles, tokens[i], payments);
            n += 2;
        }
        (calls[n], calls[n + 1]) = PayoutScope.sendScope(roles, tokens, payments);
        n += 2;
        for (uint256 i; i < p.tokens.length; ++i) {
            calls[n++] = PayoutScope.allowance(
                roles, tokens[i], p.tokens[i].ceiling, PayoutScope.periodSeconds(p.tokens[i].budgetPeriod)
            );
        }
        calls[n++] = _call(budgets, abi.encodeCall(IBudgets.configure, (roles, PAYOUT_ROLE_KEY)));
        for (uint256 i; i < p.tokens.length; ++i) {
            calls[n++] = _topBudget(p.tokens[i]);
        }
        return n;
    }

    /// @dev Claims every founding Director's Safe as signer and removes every other owner (removal recomputes the
    /// threshold). With nothing to remove the claims leave the threshold alone, so it is set to what the Gate's
    /// config gives for the founding Directors.
    function _claimAndRemove(
        Call[] memory calls,
        uint256 n,
        MoneyInstall calldata p,
        address[] memory owners
    )
        private
        view
        returns (uint256)
    {
        address gate = p.deployment.gate;
        uint256 hat = p.deployment.directorHat;
        calls[n++] = _call(gate, abi.encodeCall(IHatsSignerGate.claimSignerFor, (hat, p.founderSafe)));
        for (uint256 i; i < p.coDirectors.length; ++i) {
            calls[n++] = _call(gate, abi.encodeCall(IHatsSignerGate.claimSignerFor, (hat, p.coDirectors[i])));
        }
        bool removed;
        for (uint256 i; i < owners.length; ++i) {
            bool founding = owners[i] == p.founderSafe;
            for (uint256 j; !founding && j < p.coDirectors.length; ++j) {
                founding = owners[i] == p.coDirectors[j];
            }
            if (founding) continue;
            calls[n++] = _call(gate, abi.encodeCall(IHatsSignerGate.removeSigner, (owners[i])));
            removed = true;
        }
        if (!removed) {
            uint256 required = _required(IInstallerReads(gate).thresholdConfig(), 1 + p.coDirectors.length);
            if (IInstallerReads(p.safe).getThreshold() != required) {
                calls[n++] = _call(p.safe, abi.encodeCall(IInstallerReads.changeThreshold, (required)));
            }
        }
        return n;
    }

    /// @dev The threshold's minimum is at least 1 and at most the founding Directors, so the Board can always sign.
    function _checkThreshold(IHatsSignerGate.ThresholdConfig memory c, uint256 coDirectors) private pure {
        if (c.min == 0 || c.min > 1 + coDirectors) revert InvalidInstall(InstallRefusal.ThresholdInvalid);
    }

    function _topBudget(Token memory t) private view returns (Call memory) {
        return
            _call(budgets, abi.encodeCall(IBudgets.createTopBudget, (t.token, t.budgetPeriod, t.topAmount, t.topHat)));
    }

    /// @dev The Safe's modules in list order, read a page at a time.
    function _modulesOf(address safe) private view returns (address[] memory all) {
        address start = SENTINEL;
        do {
            (address[] memory page, address next) = ISafe(safe).getModulesPaginated(start, 50);
            address[] memory merged = new address[](all.length + page.length);
            for (uint256 i; i < all.length; ++i) {
                merged[i] = all[i];
            }
            for (uint256 i; i < page.length; ++i) {
                merged[all.length + i] = page[i];
            }
            all = merged;
            start = next;
        } while (start != SENTINEL);
    }

    /// @dev The Gate's required signatures for `owners` owners, capped by the owner count (Safe's own bound).
    function _required(IHatsSignerGate.ThresholdConfig memory c, uint256 owners) private pure returns (uint256 r) {
        if (c.thresholdType == IHatsSignerGate.TargetThresholdType.ABSOLUTE) {
            r = owners < c.min ? c.min : owners > c.target ? c.target : owners;
        } else {
            r = (owners * c.target + 9999) / 10_000;
            if (r < c.min) r = c.min;
        }
        if (r > owners) r = owners;
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
    // forge-lint: disable-end
}
