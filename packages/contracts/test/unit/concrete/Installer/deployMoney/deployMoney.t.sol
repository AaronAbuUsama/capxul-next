// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Addresses } from "../../../../fork/Addresses.sol";
import { IInstaller } from "../../../../../src/interfaces/IInstaller.sol";
import { IHatsSignerGate } from "../../../../../src/interfaces/external/IHatsSignerGate.sol";
import { IModuleProxyFactory } from "../../../../../src/interfaces/external/IModuleProxyFactory.sol";
import { IRoles } from "../../../../../src/interfaces/external/IRoles.sol";
import { Installer_Fork_Base } from "../../../../utils/Installer/Installer_Fork_Base.sol";

/// @notice spec/installer.md step 1 on the real Hats, Roles, ModuleProxyFactory and Hats Signer Gate v2.
contract DeployMoney_Installer_Unit_Concrete_Test is Installer_Fork_Base {
    function _refused(IInstaller.InstallRefusal reason) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IInstaller.InvalidInstall.selector, reason);
    }

    function test_WhenTheSafeOrTheFoundersSafeIsZeroOrHasNoCode() external {
        // it should revert with InvalidInstall
        address noCode = makeAddr("no code");
        IInstaller.MoneyDeploy memory p = _moneyDeploy();

        p.safe = address(0);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.SafeInvalid));
        installer.deployMoney(p);

        p.safe = noCode;
        vm.expectRevert(_refused(IInstaller.InstallRefusal.SafeInvalid));
        installer.deployMoney(p);

        p = _moneyDeploy();
        p.founderSafe = address(0);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.FounderSafeInvalid));
        installer.deployMoney(p);

        p.founderSafe = noCode;
        vm.expectRevert(_refused(IInstaller.InstallRefusal.FounderSafeInvalid));
        installer.deployMoney(p);
    }

    function test_WhenACo_DirectorsSafeIsZeroOrHasNoCodeOrIsRepeatedOrIsTheFoundersSafe() external {
        // it should revert with InvalidInstall
        IInstaller.MoneyDeploy memory p = _moneyDeploy();
        p.threshold = _threshold(1, 1);

        p.coDirectors[0] = address(0);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.CoDirectorInvalid));
        installer.deployMoney(p);

        p.coDirectors[0] = makeAddr("no code");
        vm.expectRevert(_refused(IInstaller.InstallRefusal.CoDirectorInvalid));
        installer.deployMoney(p);

        p.coDirectors[0] = address(founderSafe);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.CoDirectorInvalid));
        installer.deployMoney(p);

        p.coDirectors = new address[](2);
        p.coDirectors[0] = address(benSafe);
        p.coDirectors[1] = address(benSafe);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.CoDirectorInvalid));
        installer.deployMoney(p);
    }

    function test_WhenTheFoundersSafeOrACo_DirectorsSafeIsTheCompanySafe() external {
        // it should revert with InvalidInstall
        // The company Safe is never the Director hat's eligibility, toggle or wearer (HSG README:34): it would sign
        // for itself and rule on its own Directors.
        IInstaller.MoneyDeploy memory p = _moneyDeploy();
        p.founderSafe = address(companySafe);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.FounderSafeInvalid));
        installer.deployMoney(p);

        p = _moneyDeploy();
        p.coDirectors[0] = address(companySafe);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.CoDirectorInvalid));
        installer.deployMoney(p);
    }

    function test_WhenTheThresholdsMinIs0OrAboveTheNumberOfFoundingDirectors() external {
        // it should revert with InvalidInstall
        IInstaller.MoneyDeploy memory p = _moneyDeploy();

        p.threshold = _threshold(0, 1);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.ThresholdInvalid));
        installer.deployMoney(p);

        // Two founding Directors (Amira and Ben): a minimum of three could never sign.
        p.threshold = _threshold(3, 3);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.ThresholdInvalid));
        installer.deployMoney(p);

        // The bound moves with the co-Directors: with none, two is already too many.
        p.coDirectors = new address[](0);
        p.threshold = _threshold(2, 2);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.ThresholdInvalid));
        installer.deployMoney(p);
    }

    modifier whenTheInputsAreValid() {
        _;
    }

    function test_WhenTheInputsAreValid() external whenTheInputsAreValid {
        address[] memory modulesBefore = _modules(address(companySafe));
        IInstaller.MoneyDeploy memory p = _moneyDeploy();

        // it should let anyone call it
        vm.expectEmit(true, true, false, false, address(installer));
        emit IInstaller.MoneyDeployed(address(companySafe), address(founderSafe), _emptyDeployment());
        IInstaller.MoneyDeployment memory d = _deployMoney(p); // sent by Eve

        // it should mint the Board's top hat and hand it to the company Safe
        assertTrue(_isWearer(address(companySafe), d.boardTopHat), "the Safe wears the Board's top hat");
        assertEq(_hatAdmin(d.boardTopHat), d.boardTopHat, "the Board's hat is a top hat");

        // it should create each officer hat as a direct child of the Board's top hat
        // it should make the company Safe each officer hat's eligibility and toggle
        assertEq(d.officerHats.length, 2, "one officer hat per Officer");
        for (uint256 i; i < d.officerHats.length; ++i) {
            assertEq(_hatAdmin(d.officerHats[i]), d.boardTopHat, "officer hat under the Board's top hat");
            (, uint32 maxSupply,, address eligibility, address toggle,,,,) = HATS_V1.viewHat(d.officerHats[i]);
            assertEq(maxSupply, p.officers[i].maxSupply, "officer max supply");
            assertEq(eligibility, address(companySafe), "officer eligibility is the Safe");
            assertEq(toggle, address(companySafe), "officer toggle is the Safe");
            assertTrue(HATS_V1.isAdminOfHat(address(companySafe), d.officerHats[i]), "the Safe administers it");
        }

        // it should mint the Shareholders' top hat and hand it to the founder's Safe
        assertTrue(_isWearer(address(founderSafe), d.shareholdersTopHat), "Amira's Safe wears the Shareholders' hat");
        assertEq(_hatAdmin(d.shareholdersTopHat), d.shareholdersTopHat, "the Shareholders' hat is a top hat");
        assertTrue(d.shareholdersTopHat != d.boardTopHat, "two trees");

        // it should create the Director hat mutable with max supply one plus the co-Directors under the Shareholders'
        // top hat
        // it should make the founder's Safe the Director hat's eligibility and toggle
        {
            (, uint32 maxSupply, uint32 supply, address eligibility, address toggle,,, bool mutable_, bool active) =
                HATS_V1.viewHat(d.directorHat);
            assertEq(_hatAdmin(d.directorHat), d.shareholdersTopHat, "Director under the Shareholders' top hat");
            assertTrue(mutable_, "Director hat is mutable");
            assertTrue(active, "Director hat is active");
            assertEq(maxSupply, 1 + p.coDirectors.length, "max supply 1 + co-Directors");
            assertEq(supply, 2, "two Directors");
            assertEq(eligibility, address(founderSafe), "eligibility is Amira's Safe");
            assertEq(toggle, address(founderSafe), "toggle is Amira's Safe");
        }

        // it should mint the Director hat to the founder's Safe and to every co-Director's Safe
        assertTrue(_isWearer(address(founderSafe), d.directorHat), "Amira's Safe is a Director");
        assertTrue(_isWearer(address(benSafe), d.directorHat), "Ben's Safe is a Director");

        // it should never make the company Safe an admin or eligibility or toggle of the Director hat
        assertFalse(HATS_V1.isAdminOfHat(address(companySafe), d.directorHat), "the Safe is not the Director's admin");
        assertFalse(_isWearer(address(companySafe), d.directorHat), "the Safe is not a Director");

        // it should deploy Roles with the Safe as owner and avatar and target
        assertGt(d.roles.code.length, 0, "Roles deployed");
        assertEq(IRoles(d.roles).owner(), address(companySafe), "Roles owner");
        assertEq(IRoles(d.roles).avatar(), address(companySafe), "Roles avatar");
        assertEq(IRoles(d.roles).target(), address(companySafe), "Roles target until the batch");

        // it should deploy the Gate with the Shareholders' top hat as owner and the Director hat as signer hat
        assertGt(d.gate.code.length, 0, "Gate deployed");
        assertEq(_gateView().safe(), address(companySafe), "Gate's Safe");
        assertEq(_gateView().ownerHat(), d.shareholdersTopHat, "Gate's owner hat");
        assertTrue(_gateView().isValidSignerHat(d.directorHat), "Director is a signer hat");
        assertTrue(_gateView().claimableFor(), "claimableFor on");
        assertFalse(_gateView().locked(), "not locked");

        // it should set the Gate's threshold config to the one chosen at setup and Roles as its module
        IHatsSignerGate.ThresholdConfig memory c = _gateView().thresholdConfig();
        assertEq(uint8(c.thresholdType), uint8(p.threshold.thresholdType), "threshold type");
        assertEq(c.min, p.threshold.min, "threshold min");
        assertEq(c.target, p.threshold.target, "threshold target");
        assertTrue(_gateView().isModuleEnabled(d.roles), "Roles is a Gate module");

        // deployMoney never touches the Safe: the batch does.
        address[] memory modulesAfter = _modules(address(companySafe));
        assertEq(modulesAfter.length, modulesBefore.length, "Safe modules unchanged");
        assertEq(modulesAfter[0], SAFE_4337_MODULE, "4337 module still there");

        // it should wear no hat and hold nothing afterwards
        _assertInstallerHoldsNothing(d);

        // it should return the two top hats and the Director hat and the officer hats and Roles and the Gate
        (uint256 board, uint256 shareholders) = (d.boardTopHat, d.shareholdersTopHat);
        assertTrue(board != 0 && shareholders != 0 && d.directorHat != 0, "hats returned");
        assertTrue(d.roles != address(0) && d.gate != address(0) && d.roles != d.gate, "modules returned");
    }

    function test_GivenACorrectRolesOrGateIsAlreadyAtThePredictedAddress() external whenTheInputsAreValid {
        IInstaller.MoneyDeploy memory p = _moneyDeploy();
        (, uint256 shareholders) = _nextTopHats();
        uint256 director = _firstChild(shareholders);

        // Eve front-runs both deployments with the identical configuration.
        vm.startPrank(users.eve);
        address roles = IModuleProxyFactory(Addresses.MODULE_PROXY_FACTORY)
            .deployModule(
                Addresses.ROLES_V2_MASTERCOPY,
                abi.encodeCall(IRoles.setUp, (abi.encode(p.safe, p.safe, p.safe))),
                uint256(p.salt)
            );
        uint256[] memory signerHats = new uint256[](1);
        signerHats[0] = director;
        address[] memory gateModules = new address[](1);
        gateModules[0] = roles;
        IHatsSignerGate.SetupParams memory params = IHatsSignerGate.SetupParams({
            ownerHat: shareholders,
            signerHats: signerHats,
            safe: p.safe,
            thresholdConfig: p.threshold,
            locked: false,
            claimableFor: true,
            implementation: Addresses.HATS_SIGNER_GATE_V2,
            hsgGuard: address(0),
            hsgModules: gateModules
        });
        address gateAt = IModuleProxyFactory(Addresses.MODULE_PROXY_FACTORY)
            .deployModule(
                Addresses.HATS_SIGNER_GATE_V2,
                abi.encodeCall(IHatsSignerGate.setUp, (abi.encode(params))),
                uint256(p.salt)
            );
        vm.stopPrank();
        bytes32 rolesCode = roles.codehash;
        bytes32 gateCode = gateAt.codehash;

        // it should accept it and deploy nothing there
        IInstaller.MoneyDeployment memory d = _deployMoney(p);
        assertEq(d.roles, roles, "the Roles already there");
        assertEq(d.gate, gateAt, "the Gate already there");
        assertEq(d.shareholdersTopHat, shareholders, "the predicted Shareholders' top hat");
        assertEq(d.directorHat, director, "the predicted Director hat");
        assertEq(roles.codehash, rolesCode, "Roles untouched");
        assertEq(gateAt.codehash, gateCode, "Gate untouched");
        assertEq(IRoles(d.roles).avatar(), address(companySafe), "Roles still the Safe's");
        _assertInstallerHoldsNothing(d);
    }

    function _emptyDeployment() internal pure returns (IInstaller.MoneyDeployment memory d) { }

    /// @dev I2 after `deployMoney`.
    function _assertInstallerHoldsNothing(IInstaller.MoneyDeployment memory d) internal view {
        address self = address(installer);
        assertFalse(_isWearer(self, d.boardTopHat), "Installer wears no Board top hat");
        assertFalse(_isWearer(self, d.shareholdersTopHat), "Installer wears no Shareholders' top hat");
        assertFalse(_isWearer(self, d.directorHat), "Installer wears no Director hat");
        for (uint256 i; i < d.officerHats.length; ++i) {
            assertFalse(_isWearer(self, d.officerHats[i]), "Installer wears no officer hat");
        }
        assertEq(usdc.balanceOf(self), 0, "Installer holds no USDC");
        assertEq(self.balance, 0, "Installer holds no ETH");
        assertFalse(_gateView().isModuleEnabled(self), "Installer is no Gate module");
        assertFalse(_rolesView().isModuleEnabled(self), "Installer is no Roles member");
        assertFalse(companySafe.isModuleEnabled(self), "Installer is no Safe module");
    }
}
