// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IInstaller } from "../interfaces/IInstaller.sol";
import { IHats } from "../interfaces/external/IHats.sol";
import { IHatsElectionEligibility } from "../interfaces/external/IHatsElectionEligibility.sol";
import { IHatsModuleFactory } from "../interfaces/external/IHatsModuleFactory.sol";
import { IHatsSignerGate } from "../interfaces/external/IHatsSignerGate.sol";
import { ISafe } from "../interfaces/external/ISafe.sol";
import { InstallerBase } from "./InstallerBase.sol";

/// @title InstallerElections
/// @notice The board extras of spec/board.md: `deployElections` creates a seat group's Hats Elections clone (J5: one
/// per Director hat) and `buildElections` returns the Governor's batch that attaches it.
abstract contract InstallerElections is InstallerBase {
    // forge-lint: disable-start(calls-loop, require-revert-in-loop, reentrancy-events, unused-return, uninitialized-local, block-timestamp, divide-before-multiply, unsafe-typecast)
    // The Installer is a one-shot deploy and view helper: it holds no funds and no authority (I2), so its loops of
    // calls, its events after calls, and its refusals inside input loops cannot be reentered for gain. Loop counters
    // and flags start at zero and false. It compares times because a term or period is a time. Casts are of values
    // bounded by the caller's own list lengths or by Roles' own types.
    /// @inheritdoc IInstaller
    function deployElections(ElectionsDeploy calldata p) external returns (address elections) {
        // The seat group's hat is a mutable hat in the Shareholders' tree, so Elections can be attached to it.
        (,,,,,,, bool isMutable,) = IHats(hats).viewHat(p.directorHat);
        if (!isMutable || p.directorHat >> 224 != p.money.shareholdersTopHat >> 224) {
            revert InvalidInstall(InstallRefusal.DirectorHatInvalid);
        }
        if (p.firstTermEnd <= block.timestamp) revert InvalidInstall(InstallRefusal.FirstTermEndInvalid);

        elections = _predictElections(p.directorHat, p.money.shareholdersTopHat);
        if (elections.code.length == 0) {
            IHatsModuleFactory(hatsModuleFactory)
                .createHatsModule(
                    electionsImplementation,
                    p.directorHat,
                    abi.encodePacked(p.money.shareholdersTopHat, uint256(0)),
                    abi.encode(p.firstTermEnd),
                    0
                );
        }
        // The clone's salt omits its init data, so someone may have made it first with another term (R3 section 3).
        if (IHatsElectionEligibility(elections).currentTermEnd() != p.firstTermEnd) {
            revert InvalidInstall(InstallRefusal.ElectionsTermMismatch);
        }
        emit ElectionsDeployed(p.safe, elections, p.directorHat, p.firstTermEnd);
    }

    /// @inheritdoc IInstaller
    function buildElections(ElectionsInstall calldata p) external view returns (Call[] memory governorCalls) {
        if (p.elections != _predictElections(p.directorHat, p.money.shareholdersTopHat)) {
            revert InvalidInstall(InstallRefusal.NotCompanyClones);
        }
        IHats h = IHats(hats);
        address[] memory owners = ISafe(p.safe).getOwners();
        governorCalls = new Call[](4 + owners.length + p.winners.length);
        uint256 n;
        governorCalls[n++] =
            _call(p.elections, abi.encodeCall(IHatsElectionEligibility.elect, (p.firstTermEnd, p.winners)));
        governorCalls[n++] = _call(hats, abi.encodeCall(IHats.changeHatEligibility, (p.directorHat, p.elections)));
        // A sitting Director who was not re-elected turns ineligible; burning frees the seat (a lapsed token still
        // counts toward the max supply).
        for (uint256 i; i < owners.length; ++i) {
            if (h.isWearerOfHat(owners[i], p.directorHat) && !_isIn(p.winners, owners[i])) {
                governorCalls[n++] = _call(hats, abi.encodeCall(IHats.checkHatWearerStatus, (p.directorHat, owners[i])));
            }
        }
        (, uint32 maxSupply,,,,,,,) = h.viewHat(p.directorHat);
        if (maxSupply != p.seats) {
            governorCalls[n++] = _call(hats, abi.encodeCall(IHats.changeHatMaxSupply, (p.directorHat, p.seats)));
        }
        // Winning an election does not mint the hat: mint to each new winner, only after `elect`.
        for (uint256 i; i < p.winners.length; ++i) {
            if (!h.isWearerOfHat(p.winners[i], p.directorHat)) {
                governorCalls[n++] = _call(hats, abi.encodeCall(IHats.mintHat, (p.directorHat, p.winners[i])));
            }
        }
        governorCalls[n++] = _call(p.money.gate, abi.encodeCall(IHatsSignerGate.setThresholdConfig, (p.threshold)));
        assembly ("memory-safe") {
            mstore(governorCalls, n)
        }
    }

    function _isIn(address[] calldata list, address who) private pure returns (bool) {
        for (uint256 i; i < list.length; ++i) {
            if (list[i] == who) return true;
        }
        return false;
    }
    // forge-lint: disable-end
}
