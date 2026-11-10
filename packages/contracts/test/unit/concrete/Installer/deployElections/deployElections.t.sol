// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Addresses } from "../../../../fork/Addresses.sol";
import { IInstaller } from "../../../../../src/interfaces/IInstaller.sol";
import { IHatsElectionEligibility } from "../../../../../src/interfaces/external/IHatsElectionEligibility.sol";
import { IHatsModuleFactory } from "../../../../../src/interfaces/external/IHatsModuleFactory.sol";
import { Installer_Fork_Base } from "../../../../utils/Installer/Installer_Fork_Base.sol";
import { IElectionsArgs } from "../../../../utils/Installer/ExternalViews.sol";

/// @notice spec/board.md "Adding Hats Elections later" step 1 and research R3 section 3 (the clone's salt omits
/// its init data, so it can be front-run with another first term).
contract DeployElections_Installer_Unit_Concrete_Test is Installer_Fork_Base {
    uint128 internal firstTermEnd;

    function _refused(IInstaller.InstallRefusal reason) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IInstaller.InvalidInstall.selector, reason);
    }

    function _electionsDeploy(IInstaller.MoneyDeployment memory d)
        internal
        returns (IInstaller.ElectionsDeploy memory p)
    {
        firstTermEnd = uint128(block.timestamp + 365 days);
        p = IInstaller.ElectionsDeploy({
            safe: address(companySafe), money: d, directorHat: d.directorHat, firstTermEnd: firstTermEnd
        });
    }

    function _predicted(IInstaller.MoneyDeployment memory d) internal view returns (address) {
        return IHatsModuleFactory(Addresses.HATS_MODULE_FACTORY)
            .getHatsModuleAddress(
                Addresses.HATS_ELECTION_ELIGIBILITY,
                d.directorHat,
                abi.encodePacked(d.shareholdersTopHat, uint256(0)),
                0
            );
    }

    /// @dev Eve creates the clone first, as anyone can.
    function _frontRun(IInstaller.MoneyDeployment memory d, uint128 termEnd) internal returns (address) {
        vm.prank(users.eve);
        return IHatsModuleFactory(Addresses.HATS_MODULE_FACTORY)
            .createHatsModule(
                Addresses.HATS_ELECTION_ELIGIBILITY,
                d.directorHat,
                abi.encodePacked(d.shareholdersTopHat, uint256(0)),
                abi.encode(termEnd),
                0
            );
    }

    function test_WhenTheDirectorHatOrTheFirstTermEndIsInvalid() external {
        // it should revert with InvalidInstall
        IInstaller.MoneyDeployment memory d = _deployMoney();

        // A Director hat that does not exist.
        IInstaller.ElectionsDeploy memory p = _electionsDeploy(d);
        p.directorHat = d.shareholdersTopHat | (uint256(9) << 208);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.DirectorHatInvalid));
        installer.deployElections(p);

        // A hat that is not mutable, so Elections could never be attached: the Shareholders' top hat itself.
        p = _electionsDeploy(d);
        p.directorHat = d.shareholdersTopHat;
        vm.expectRevert(_refused(IInstaller.InstallRefusal.DirectorHatInvalid));
        installer.deployElections(p);

        // A first term that has already ended, or ends now.
        p = _electionsDeploy(d);
        p.firstTermEnd = uint128(block.timestamp);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.FirstTermEndInvalid));
        installer.deployElections(p);
        p.firstTermEnd = 0;
        vm.expectRevert(_refused(IInstaller.InstallRefusal.FirstTermEndInvalid));
        installer.deployElections(p);
    }

    function test_GivenSomeoneDeployedTheElectionsCloneFirstWithAnotherFirstTerm() external {
        // it should revert with InvalidInstall
        IInstaller.MoneyDeployment memory d = _deployMoney();
        IInstaller.ElectionsDeploy memory p = _electionsDeploy(d);
        _frontRun(d, p.firstTermEnd + 1);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.ElectionsTermMismatch));
        installer.deployElections(p);
    }

    modifier whenTheInputsAreValid() {
        _;
    }

    function test_WhenTheInputsAreValid() external whenTheInputsAreValid {
        IInstaller.MoneyDeployment memory d = _deployMoney();
        IInstaller.ElectionsDeploy memory p = _electionsDeploy(d);
        address predicted = _predicted(d);
        assertEq(predicted.code.length, 0, "no clone yet");

        vm.expectEmit(address(installer));
        emit IInstaller.ElectionsDeployed(address(companySafe), predicted, d.directorHat, p.firstTermEnd);
        vm.prank(users.eve); // anyone may call it
        address elections = installer.deployElections(p);

        // it should create the Elections clone for the Director hat through the HatsModuleFactory
        assertEq(elections, predicted, "at HatsModuleFactory's address for salt nonce 0");
        assertGt(elections.code.length, 0, "created");
        assertEq(IElectionsArgs(elections).hatId(), d.directorHat, "for the Director hat");

        // it should set the ballot box hat to the Shareholders' top hat and the admin hat to 0
        assertEq(IElectionsArgs(elections).BALLOT_BOX_HAT(), d.shareholdersTopHat, "ballot box");
        assertEq(IElectionsArgs(elections).ADMIN_HAT(), 0, "admin hat 0: the Director hat's admins");

        // it should read back the current term end and require the first term end
        assertEq(IHatsElectionEligibility(elections).currentTermEnd(), p.firstTermEnd, "first term");

        // it should return the Elections address
        assertEq(elections, _predicted(d), "returned address");
        assertFalse(_isWearer(address(installer), d.shareholdersTopHat), "the Installer wears nothing (I2)");
    }

    function test_GivenAnotherSeatGroupsDirectorHat() external whenTheInputsAreValid {
        IInstaller.MoneyDeployment memory d = _deployMoney();
        uint256 seriesA = _seatGroup(d, "Series A Director");
        IInstaller.ElectionsDeploy memory p = _electionsDeploy(d);
        p.directorHat = seriesA;

        // it should create a separate Elections clone for that hat
        address predicted = IHatsModuleFactory(Addresses.HATS_MODULE_FACTORY)
            .getHatsModuleAddress(
                Addresses.HATS_ELECTION_ELIGIBILITY, seriesA, abi.encodePacked(d.shareholdersTopHat, uint256(0)), 0
            );
        assertTrue(predicted != _predicted(d), "its own address");
        vm.expectEmit(address(installer));
        emit IInstaller.ElectionsDeployed(address(companySafe), predicted, seriesA, p.firstTermEnd);
        vm.prank(users.eve);
        address elections = installer.deployElections(p);
        assertEq(elections, predicted, "the group's clone");
        assertEq(IElectionsArgs(elections).hatId(), seriesA, "for the Series A hat");
        assertEq(IHatsElectionEligibility(elections).currentTermEnd(), p.firstTermEnd, "its first term");

        // The first group's clone is still free to deploy, and is another contract.
        p.directorHat = d.directorHat;
        address first = installer.deployElections(p);
        assertTrue(first != elections && first == _predicted(d), "the first group's own clone");

        // A hat from another tree (an officer hat of the Board, mutable) is not a seat group's.
        p.directorHat = d.officerHats[0];
        vm.expectRevert(_refused(IInstaller.InstallRefusal.DirectorHatInvalid));
        installer.deployElections(p);
    }

    function test_GivenTheIdenticalCloneIsAlreadyDeployed() external whenTheInputsAreValid {
        IInstaller.MoneyDeployment memory d = _deployMoney();
        IInstaller.ElectionsDeploy memory p = _electionsDeploy(d);
        address existing = _frontRun(d, p.firstTermEnd);

        // it should accept it
        address elections = installer.deployElections(p);
        assertEq(elections, existing, "the clone already there");
        assertEq(IHatsElectionEligibility(elections).currentTermEnd(), p.firstTermEnd, "its first term");
    }
}
