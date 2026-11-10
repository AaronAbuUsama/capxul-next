// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IInstaller } from "../../../../src/interfaces/IInstaller.sol";
import { Installer_Hermetic_Base } from "../../../utils/Installer/Installer_Hermetic_Base.sol";

/// @notice deployElections' first-term range (trees/Installer/deployElections.tree): any end at or before now is
/// refused before anything is created.
contract DeployElections_Installer_Unit_Fuzz_Test is Installer_Hermetic_Base {
    function testFuzz_RevertWhen_TheFirstTermEndIsNotInTheFuture(uint128 termEnd, uint64 elapsed) external {
        uint256 nowAt = vm.getBlockTimestamp() + bound(elapsed, 0, 100 * 365 days);
        vm.warp(nowAt);
        uint128 end = uint128(bound(termEnd, 0, nowAt));
        IInstaller.MoneyDeployment memory d = _deployment();
        d.roles = address(rolesStub);
        d.gate = address(gateStub);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.FirstTermEndInvalid));
        installer.deployElections(
            IInstaller.ElectionsDeploy({
                safe: address(companySafe), money: d, directorHat: d.directorHat, firstTermEnd: end
            })
        );
    }
}
