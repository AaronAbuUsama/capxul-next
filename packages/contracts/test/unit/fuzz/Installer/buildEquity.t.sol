// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IInstaller } from "../../../../src/interfaces/IInstaller.sol";
import { Installer_Hermetic_Base } from "../../../utils/Installer/Installer_Hermetic_Base.sol";

/// @notice buildEquity refuses any set of addresses the Installer did not clone for the Safe
/// (trees/Installer/buildEquity.tree).
contract BuildEquity_Installer_Unit_Fuzz_Test is Installer_Hermetic_Base {
    function testFuzz_RevertWhen_TheAddressesAreNotThisCompanysClones(IInstaller.EquityDeployment memory e) external {
        IInstaller.MoneyDeployment memory d = _deployment();
        d.roles = address(rolesStub);
        d.gate = address(gateStub);
        IInstaller.EquityInstall memory p;
        p.safe = address(companySafe);
        p.founderSafe = address(founderSafe);
        p.money = d;
        p.equity = e;
        p.founders = new IInstaller.FounderShares[](0);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.NotCompanyClones));
        installer.buildEquity(p);
    }
}
