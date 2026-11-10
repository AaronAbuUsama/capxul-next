// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Vm } from "forge-std/Vm.sol";

import { Addresses } from "../../../../fork/Addresses.sol";
import { ICaptable } from "../../../../../src/interfaces/ICaptable.sol";
import { IInstaller } from "../../../../../src/interfaces/IInstaller.sol";
import { IHatsModuleFactory } from "../../../../../src/interfaces/external/IHatsModuleFactory.sol";
import {
    MockCaptable,
    MockExits,
    MockGovernor,
    MockOptions,
    MockRounds
} from "../../../../utils/Installer/EquityMocks.sol";
import { Installer_Fork_Base } from "../../../../utils/Installer/Installer_Fork_Base.sol";

/// @notice spec/installer.md "Equity extras" and spec/captable.md: the equity clones, created and wired once,
/// with no power until the company Safe runs `buildEquity`'s calls.
contract DeployEquity_Installer_Unit_Concrete_Test is Installer_Fork_Base {
    function _refused(IInstaller.InstallRefusal reason) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IInstaller.InvalidInstall.selector, reason);
    }

    function test_WhenTheSafeIsZeroOrTheCompanyAlreadyHasEquity() external {
        // it should revert with InvalidInstall
        IInstaller.MoneyDeployment memory d = _deployMoney();
        IInstaller.EquityDeploy memory p = _equityDeploy(d);

        p.safe = address(0);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.SafeInvalid));
        installer.deployEquity(p);

        p = _equityDeploy(d);
        installer.deployEquity(p);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.EquityExists));
        installer.deployEquity(p);
    }

    function test_GivenSomeoneDeployedEquityForTheSafeFirstWithOtherTerms() external {
        IInstaller.MoneyDeployment memory d = _deployMoney();

        // Eve deploys equity for the company first, under another name and with no classes.
        IInstaller.EquityDeploy memory evil = _equityDeploy(d);
        evil.name = "Eve Holdings";
        evil.initialClasses = new ICaptable.ClassParams[](0);
        vm.prank(users.eve);
        IInstaller.EquityDeployment memory squatted = installer.deployEquity(evil);

        // it should still deploy the company's own clones
        IInstaller.EquityDeployment memory e = installer.deployEquity(_equityDeploy(d));
        assertTrue(e.captable != squatted.captable, "a separate Captable");
        assertTrue(e.governor != squatted.governor, "a separate Governor");
        assertEq(MockCaptable(e.captable).companyName(), "Acme", "the company's own name");
        assertEq(MockCaptable(e.captable).classCount(), 1, "the company's own classes");
    }

    function test_WhenTheInstallIsValid() external {
        IInstaller.MoneyDeployment memory d = _deployMoney();
        IInstaller.EquityDeploy memory p = _equityDeploy(d);
        vm.recordLogs();
        vm.prank(users.eve);
        IInstaller.EquityDeployment memory e = installer.deployEquity(p);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        // it should clone and initialize the Captable and Options and Governor and Rounds and Exits
        _assertClone(e.captable, captableImpl, "Captable");
        _assertClone(e.governor, governorImpl, "Governor");
        _assertClone(e.options, optionsImpl, "Options");
        _assertClone(e.rounds, roundsImpl, "Rounds");
        _assertClone(e.exits, exitsImpl, "Exits");
        assertTrue(MockCaptable(e.captable).initialized(), "Captable initialised");
        assertTrue(MockGovernor(e.governor).initialized(), "Governor initialised");
        assertTrue(MockOptions(e.options).initialized(), "Options initialised");
        assertTrue(MockRounds(e.rounds).initialized(), "Rounds initialised");
        assertTrue(MockExits(e.exits).initialized(), "Exits initialised");

        // it should wire every clone to the others once
        ICaptable.Wiring memory w = MockCaptable(e.captable).wiring();
        assertEq(w.safe, address(companySafe), "Captable: Safe");
        assertEq(w.governor, e.governor, "Captable: Governor");
        assertEq(w.vesting, address(vestingMock), "Captable: Vesting");
        assertEq(w.options, e.options, "Captable: Options");
        assertEq(w.rounds, e.rounds, "Captable: Rounds");
        assertEq(w.exits, e.exits, "Captable: Exits");
        assertEq(w.shareClassImpl, shareClassImpl, "Captable: ShareClass implementation");

        MockGovernor g = MockGovernor(e.governor);
        assertEq(g.votes(), e.captable, "Governor votes with the Captable");
        assertEq(g.safe(), address(companySafe), "Governor: Safe");
        assertEq(g.name(), "Acme", "Governor: name");
        assertEq(g.votingDelay(), p.governor.votingDelay, "voting delay");
        assertEq(g.votingPeriod(), p.governor.votingPeriod, "voting period");
        assertEq(g.proposalThreshold(), p.governor.proposalThreshold, "proposal threshold");
        assertEq(g.quorumNumerator(), p.governor.quorumNumerator, "quorum");
        assertTrue(g.isAllowedTarget(e.captable), "allowed: Captable");
        assertTrue(g.isAllowedTarget(Addresses.HATS), "allowed: Hats");
        assertTrue(g.isAllowedTarget(e.elections), "allowed: Elections");
        assertTrue(g.isAllowedTarget(d.gate), "allowed: the Gate");
        assertTrue(g.isAllowedTarget(e.rounds), "allowed: Rounds");
        assertTrue(g.isAllowedTarget(e.exits), "allowed: Exits");
        assertFalse(g.isAllowedTarget(address(companySafe)), "never the Safe (G1)");

        assertEq(
            e.elections,
            IHatsModuleFactory(Addresses.HATS_MODULE_FACTORY)
                .getHatsModuleAddress(
                    Addresses.HATS_ELECTION_ELIGIBILITY,
                    d.directorHat,
                    abi.encodePacked(d.shareholdersTopHat, uint256(0)),
                    0
                ),
            "the predicted Elections clone"
        );
        assertEq(e.elections.code.length, 0, "Elections is deployed later");

        MockOptions o = MockOptions(e.options);
        assertEq(o.safe(), address(companySafe), "Options: Safe");
        assertEq(o.captable(), e.captable, "Options: Captable");
        assertEq(o.payments(), address(paymentsMock), "Options: Payments");
        assertEq(o.classId(), p.poolClassId, "Options: pool class");

        MockRounds r = MockRounds(e.rounds);
        assertEq(r.safe(), address(companySafe), "Rounds: Safe");
        assertEq(r.captable(), e.captable, "Rounds: Captable");
        assertEq(r.payments(), address(paymentsMock), "Rounds: Payments");

        MockExits x = MockExits(e.exits);
        assertEq(x.safe(), address(companySafe), "Exits: Safe");
        assertEq(x.captable(), e.captable, "Exits: Captable");
        assertEq(x.options(), e.options, "Exits: Options");
        assertEq(x.vesting(), address(vestingMock), "Exits: Vesting");
        assertEq(x.payments(), address(paymentsMock), "Exits: Payments");
        assertEq(x.governor(), e.governor, "Exits: Governor");
        assertEq(x.escrowFactory(), escrowFactoryStandIn, "Exits: EscrowFactory");

        // it should create the template's initial classes in the Captable's initialize
        assertEq(MockCaptable(e.captable).companyName(), "Acme", "company name");
        assertEq(MockCaptable(e.captable).classCount(), 1, "one initial class");
        assertEq(MockCaptable(e.captable).authorised(0), 10_000_000, "Common's authorised amount");

        // it should give no clone any power until the Safe executes the equity calls
        assertEq(MockCaptable(e.captable).issuerAllowance(e.options, 0), 0, "Options may issue nothing");
        assertEq(MockCaptable(e.captable).issuerAllowance(address(vestingMock), 0), 0, "Vesting may issue nothing");
        assertEq(MockCaptable(e.captable).issuerAllowance(e.rounds, 0), 0, "Rounds may issue nothing");
        assertEq(o.pool(), 0, "no pool");
        assertFalse(_isWearer(e.governor, d.shareholdersTopHat), "the Governor wears no Shareholders' hat yet");
        assertTrue(_isWearer(address(founderSafe), d.shareholdersTopHat), "Amira's Safe still does");
        (,,, address eligibility, address toggle,,,,) = HATS_V1.viewHat(d.directorHat);
        assertEq(eligibility, address(founderSafe), "Director eligibility unchanged");
        assertEq(toggle, address(founderSafe), "Director toggle unchanged");

        // it should emit EquityDeployed with every address
        bool emitted;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(installer) || logs[i].topics[0] != IInstaller.EquityDeployed.selector) {
                continue;
            }
            assertEq(logs[i].topics[1], bytes32(uint256(uint160(address(companySafe)))), "event names the Safe");
            IInstaller.EquityDeployment memory logged = abi.decode(logs[i].data, (IInstaller.EquityDeployment));
            assertEq(keccak256(abi.encode(logged)), keccak256(abi.encode(e)), "event carries every address");
            emitted = true;
        }
        assertTrue(emitted, "EquityDeployed emitted");
    }

    /// @dev `clone` is an EIP-1167 minimal proxy of `implementation`, distinct from it.
    function _assertClone(address clone, address implementation, string memory what) internal view {
        assertTrue(clone != implementation, string.concat(what, " is a clone, not the implementation"));
        assertEq(
            clone.code,
            abi.encodePacked(hex"363d3d373d3d3d363d73", implementation, hex"5af43d82803e903d91602b57fd5bf3"),
            string.concat(what, " is an EIP-1167 proxy of its implementation")
        );
    }
}
