// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC5805 } from "@openzeppelin/contracts/interfaces/IERC5805.sol";
import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";

import { ICaptable } from "../interfaces/ICaptable.sol";
import { IExits } from "../interfaces/IExits.sol";
import { IGovernor } from "../interfaces/IGovernor.sol";
import { IInstaller } from "../interfaces/IInstaller.sol";
import { IOptions } from "../interfaces/IOptions.sol";
import { IRounds } from "../interfaces/IRounds.sol";
import { IVesting } from "../interfaces/IVesting.sol";
import { IHats } from "../interfaces/external/IHats.sol";
import { IHatsModuleFactory } from "../interfaces/external/IHatsModuleFactory.sol";

/// @notice What the equity half of the Installer is built with: a subset of `InstallerConfig`.
struct EquityConfig {
    address payments;
    address vesting;
    address hats;
    address hatsModuleFactory;
    address electionsImplementation;
    address captableImplementation;
    address shareClassImplementation;
    address governorImplementation;
    address optionsImplementation;
    address roundsImplementation;
    address exitsImplementation;
    address escrowFactory;
}

/// @title EquityInstaller
/// @notice The equity extras of spec/installer.md, kept in a contract of their own so the Installer stays under the
/// 24,576-byte limit. The Installer creates it once in its constructor and forwards `deployEquity` and `buildEquity`
/// calldata to it unchanged, then emits `EquityDeployed` itself. `deployEquity` clones and wires the company's
/// contracts; `buildEquity` returns the calls that finish the install and accepts only a clone set this contract made
/// for the Safe. It holds no funds and no authority (I2).
contract EquityInstaller {
    address private immutable _payments;
    address private immutable _vesting;
    address private immutable _hats;
    address private immutable _hatsModuleFactory;
    address private immutable _electionsImplementation;
    address private immutable _captableImplementation;
    address private immutable _shareClassImplementation;
    address private immutable _governorImplementation;
    address private immutable _optionsImplementation;
    address private immutable _roundsImplementation;
    address private immutable _exitsImplementation;
    address private immutable _escrowFactory;

    /// @dev Terms already deployed: `keccak256(abi.encode(EquityDeploy))`. Keyed by terms, not by Safe, so nobody can
    /// lock a company out by deploying junk first.
    mapping(bytes32 terms => bool) private _deployedTerms;
    /// @dev Clone sets made here: `keccak256(abi.encode(safe, EquityDeployment))`.
    mapping(bytes32 cloneSet => bool) private _cloneSets;

    /// @param c The shared contracts and implementations.
    constructor(EquityConfig memory c) {
        _payments = c.payments;
        _vesting = c.vesting;
        _hats = c.hats;
        _hatsModuleFactory = c.hatsModuleFactory;
        _electionsImplementation = c.electionsImplementation;
        _captableImplementation = c.captableImplementation;
        _shareClassImplementation = c.shareClassImplementation;
        _governorImplementation = c.governorImplementation;
        _optionsImplementation = c.optionsImplementation;
        _roundsImplementation = c.roundsImplementation;
        _exitsImplementation = c.exitsImplementation;
        _escrowFactory = c.escrowFactory;
    }

    // forge-lint: disable-start(calls-loop, require-revert-in-loop, unused-return, uninitialized-local)
    // A one-shot deploy and view helper that holds no funds and no authority (I2). Loop counters start at zero.

    /// @notice `IInstaller.deployEquity`.
    /// @param p The Safe, its money deployment, the company name, the first classes, the pool class and the
    /// Governor's settings.
    /// @return e The clones.
    function deployEquity(IInstaller.EquityDeploy calldata p) external returns (IInstaller.EquityDeployment memory e) {
        if (p.safe == address(0) || p.safe.code.length == 0) {
            revert IInstaller.InvalidInstall(IInstaller.InstallRefusal.SafeInvalid);
        }
        bytes32 terms = keccak256(abi.encode(p));
        if (_deployedTerms[terms]) revert IInstaller.InvalidInstall(IInstaller.InstallRefusal.EquityExists);
        _deployedTerms[terms] = true;

        e.captable = Clones.clone(_captableImplementation);
        e.governor = Clones.clone(_governorImplementation);
        e.options = Clones.clone(_optionsImplementation);
        e.rounds = Clones.clone(_roundsImplementation);
        e.exits = Clones.clone(_exitsImplementation);
        e.elections = _predictElections(p.money.directorHat, p.money.shareholdersTopHat);
        _cloneSets[keccak256(abi.encode(p.safe, e))] = true;

        ICaptable(e.captable)
            .initialize(
                p.name,
                ICaptable.Wiring({
                    safe: p.safe,
                    governor: e.governor,
                    vesting: _vesting,
                    options: e.options,
                    rounds: e.rounds,
                    exits: e.exits,
                    shareClassImpl: _shareClassImplementation
                }),
                p.initialClasses
            );
        // Never the Safe (G1). Elections is created later at the address predicted here.
        address[] memory targets = new address[](6);
        targets[0] = e.captable;
        targets[1] = _hats;
        targets[2] = e.elections;
        targets[3] = p.money.gate;
        targets[4] = e.rounds;
        targets[5] = e.exits;
        IGovernor(e.governor)
            .initialize(
                p.name,
                IERC5805(e.captable),
                p.safe,
                targets,
                p.governor.votingDelay,
                p.governor.votingPeriod,
                p.governor.proposalThreshold,
                p.governor.quorumNumerator
            );
        IOptions(e.options).initialize(p.safe, e.captable, _payments, p.poolClassId);
        IRounds(e.rounds).initialize(p.safe, e.captable, _payments);
        IExits(e.exits).initialize(p.safe, e.captable, e.options, _vesting, _payments, e.governor, _escrowFactory);
    }

    /// @notice `IInstaller.buildEquity`.
    /// @param p The Safe, the founder's Safe, the deployments, the founders' shares and the option pool.
    /// @return safeCalls The company Safe's batch.
    /// @return founderCalls The founder's Safe's batch, run after `safeCalls`.
    function buildEquity(IInstaller.EquityInstall calldata p)
        external
        view
        returns (IInstaller.Call[] memory safeCalls, IInstaller.Call[] memory founderCalls)
    {
        if (
            !_cloneSets[keccak256(abi.encode(p.safe, p.equity))]
                || p.equity.elections != _predictElections(p.money.directorHat, p.money.shareholdersTopHat)
        ) revert IInstaller.InvalidInstall(IInstaller.InstallRefusal.NotCompanyClones);

        address captable = p.equity.captable;
        safeCalls = new IInstaller.Call[](2 * p.founders.length + 2);
        uint256 n;
        for (uint256 i; i < p.founders.length; ++i) {
            IInstaller.FounderShares calldata f = p.founders[i];
            if (f.end == 0) {
                safeCalls[n++] = _call(
                    captable, abi.encodeCall(ICaptable.issue, (f.classId, f.shareholder, f.amount, f.documentHash))
                );
                continue;
            }
            // Vesting may issue exactly this grant, set just before it.
            safeCalls[n++] =
                _call(captable, abi.encodeCall(ICaptable.setIssuerAllowance, (_vesting, f.classId, f.amount)));
            safeCalls[n++] = _call(
                _vesting,
                abi.encodeCall(
                    IVesting.grantAndIssue,
                    (
                        captable,
                        f.classId,
                        f.shareholder,
                        f.amount,
                        f.start,
                        f.cliff,
                        f.end,
                        f.accelerateOnExit,
                        f.documentHash
                    )
                )
            );
        }
        if (p.optionPool != 0) {
            uint8 poolClass = IOptions(p.equity.options).classId();
            safeCalls[n++] = _call(
                captable, abi.encodeCall(ICaptable.setIssuerAllowance, (p.equity.options, poolClass, p.optionPool))
            );
            safeCalls[n++] = _call(p.equity.options, abi.encodeCall(IOptions.setPool, (p.optionPool)));
        }
        assembly ("memory-safe") {
            mstore(safeCalls, n)
        }

        // The founder's Safe hands the shareholders their tree: the Director hat, then the top hat last.
        address governor = p.equity.governor;
        founderCalls = new IInstaller.Call[](3);
        founderCalls[0] = _call(_hats, abi.encodeCall(IHats.changeHatEligibility, (p.money.directorHat, governor)));
        founderCalls[1] = _call(_hats, abi.encodeCall(IHats.changeHatToggle, (p.money.directorHat, governor)));
        founderCalls[2] =
            _call(_hats, abi.encodeCall(IHats.transferHat, (p.money.shareholdersTopHat, p.founderSafe, governor)));
    }

    // forge-lint: disable-end

    /// @dev The Elections clone `HatsModuleFactory` makes for a Director hat (as `InstallerBase._predictElections`).
    function _predictElections(uint256 directorHat, uint256 shareholdersTopHat) private view returns (address) {
        return IHatsModuleFactory(_hatsModuleFactory)
            .getHatsModuleAddress(
                _electionsImplementation, directorHat, abi.encodePacked(shareholdersTopHat, uint256(0)), 0
            );
    }

    function _call(address to, bytes memory data) private pure returns (IInstaller.Call memory) {
        return IInstaller.Call({ to: to, value: 0, data: data });
    }
}
