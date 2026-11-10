// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Addresses } from "../../../../fork/Addresses.sol";
import { IInstaller } from "../../../../../src/interfaces/IInstaller.sol";
import { IHats } from "../../../../../src/interfaces/external/IHats.sol";
import { IHatsElectionEligibility } from "../../../../../src/interfaces/external/IHatsElectionEligibility.sol";
import { IHatsSignerGate } from "../../../../../src/interfaces/external/IHatsSignerGate.sol";
import { Installer_Fork_Base } from "../../../../utils/Installer/Installer_Fork_Base.sol";

/// @notice spec/board.md "Adding Hats Elections later" steps 2 and 3, on the real Hats, Hats Elections v0.2.0 and
/// Hats Signer Gate v2. The first election keeps Amira, unseats Ben and seats Jordan on a Board of up to three.
/// Amira's Safe wears the Shareholders' top hat before the equity install, so it stands in for the Governor.
contract BuildElections_Installer_Unit_Concrete_Test is Installer_Fork_Base {
    IInstaller.MoneyDeployment internal d;
    address internal elections;
    uint128 internal firstTermEnd;

    /// @dev Money installed and the Elections clone deployed (each test does it, so each fails alone on the stub).
    modifier elected() {
        (d,) = _installMoney();
        firstTermEnd = uint128(block.timestamp + 365 days);
        elections = installer.deployElections(
            IInstaller.ElectionsDeploy({
                safe: address(companySafe), money: d, directorHat: d.directorHat, firstTermEnd: firstTermEnd
            })
        );
        _;
    }

    function _electionsInstall(uint32 seats) internal view returns (IInstaller.ElectionsInstall memory p) {
        address[] memory winners = new address[](2);
        winners[0] = address(founderSafe);
        winners[1] = address(jordanSafe);
        p = IInstaller.ElectionsInstall({
            safe: address(companySafe),
            money: d,
            directorHat: d.directorHat,
            elections: elections,
            firstTermEnd: firstTermEnd,
            winners: winners,
            seats: seats,
            threshold: _threshold(2, 2)
        });
    }

    function test_WhenTheElectionsCloneDoesNotMatchTheCompany() external elected {
        // it should reject the unrelated clone
        IInstaller.ElectionsInstall memory p = _electionsInstall(3);
        p.elections = address(0x1234);
        vm.expectRevert(
            abi.encodeWithSelector(IInstaller.InvalidInstall.selector, IInstaller.InstallRefusal.NotCompanyClones)
        );
        installer.buildElections(p);
    }

    modifier whenTheInputsAreValid() {
        _;
    }

    function test_WhenTheInputsAreValid() external whenTheInputsAreValid elected {
        IInstaller.ElectionsInstall memory p = _electionsInstall(3);
        IInstaller.Call[] memory calls = installer.buildElections(p);

        // it should return Governor calls that elect the winners for the first term first
        assertEq(calls[0].to, elections, "first call to the Elections clone");
        assertEq(
            calls[0].data,
            abi.encodeCall(IHatsElectionEligibility.elect, (firstTermEnd, p.winners)),
            "elect(firstTermEnd, winners) first"
        );

        // it should include every sitting Director who keeps the seat in the winners
        (, address[] memory elected_) = abi.decode(_args(calls[0].data), (uint128, address[]));
        assertEq(elected_[0], address(founderSafe), "Amira, who keeps her seat, is elected again");

        // it should attach the Elections clone with changeHatEligibility
        uint256 attach =
            _find(calls, Addresses.HATS, abi.encodeCall(IHats.changeHatEligibility, (d.directorHat, elections)));
        assertTrue(attach != type(uint256).max, "changeHatEligibility(Director, Elections)");

        // it should burn unelected Directors' hats with checkHatWearerStatus
        uint256 burnBen =
            _find(calls, Addresses.HATS, abi.encodeCall(IHats.checkHatWearerStatus, (d.directorHat, address(benSafe))));
        assertTrue(burnBen != type(uint256).max, "Ben's hat burned");
        assertGt(burnBen, attach, "burned once Elections rules him ineligible");
        assertEq(
            _countSelector(calls, Addresses.HATS, IHats.checkHatWearerStatus.selector), 1, "only unelected Directors"
        );

        // it should mint the Director hat to each new winner only after elect
        uint256 mintJordan =
            _find(calls, Addresses.HATS, abi.encodeCall(IHats.mintHat, (d.directorHat, address(jordanSafe))));
        assertTrue(mintJordan != type(uint256).max, "Jordan's hat minted");
        assertGt(mintJordan, burnBen, "minted after the seat is freed");
        assertEq(_countSelector(calls, Addresses.HATS, IHats.mintHat.selector), 1, "Amira already wears hers");

        // it should set the Gate's threshold config for the new Board size
        _assertHas(
            calls,
            d.gate,
            abi.encodeCall(IHatsSignerGate.setThresholdConfig, (p.threshold)),
            "setThresholdConfig for the new Board"
        );
        for (uint256 i; i < calls.length; ++i) {
            assertTrue(calls[i].to != address(companySafe), "the Governor never calls the Safe (G1)");
            assertTrue(
                bytes4(calls[i].data) != IHatsSignerGate.claimSignerFor.selector
                    && bytes4(calls[i].data) != IHatsSignerGate.removeSigner.selector,
                "claims and removals are left to anyone"
            );
        }
    }

    function test_GivenTheSeatCountChanges() external whenTheInputsAreValid elected {
        // it should change the Director hat's max supply
        IInstaller.Call[] memory calls = installer.buildElections(_electionsInstall(3));
        uint256 resize = _find(calls, Addresses.HATS, abi.encodeCall(IHats.changeHatMaxSupply, (d.directorHat, 3)));
        assertTrue(resize != type(uint256).max, "changeHatMaxSupply(Director, 3)");
        uint256 mint = _findSelector(calls, Addresses.HATS, IHats.mintHat.selector);
        assertLt(resize, mint, "room before the mint");

        // With the seat count unchanged (two), there is no resize.
        calls = installer.buildElections(_electionsInstall(2));
        assertEq(_countSelector(calls, Addresses.HATS, IHats.changeHatMaxSupply.selector), 0, "no resize");

        // A smaller Board (one seat, Amira alone): the resize shrinks the hat, after Ben's burn so the supply fits.
        IInstaller.ElectionsInstall memory p = _electionsInstall(1);
        p.winners = new address[](1);
        p.winners[0] = address(founderSafe);
        p.threshold = _threshold(1, 1);
        calls = installer.buildElections(p);
        resize = _find(calls, Addresses.HATS, abi.encodeCall(IHats.changeHatMaxSupply, (d.directorHat, 1)));
        assertTrue(resize != type(uint256).max, "changeHatMaxSupply(Director, 1)");
        uint256 burnBen =
            _find(calls, Addresses.HATS, abi.encodeCall(IHats.checkHatWearerStatus, (d.directorHat, address(benSafe))));
        assertLt(burnBen, resize, "Ben's seat freed before the shrink");
        _runAs(address(founderSafe), calls);
        (, uint32 maxSupply, uint32 supply,,,,,,) = HATS_V1.viewHat(d.directorHat);
        assertTrue(maxSupply == 1 && supply == 1, "one seat, worn by Amira");
    }

    function test_GivenAnotherSeatGroupsDirectorHat() external whenTheInputsAreValid elected {
        // Series A: its own hat and Elections clone, a signer hat on the same Gate; Jordan wins its one seat.
        uint256 seriesA = _seatGroup(d, "Series A Director");
        address clone = installer.deployElections(
            IInstaller.ElectionsDeploy({
                safe: address(companySafe), money: d, directorHat: seriesA, firstTermEnd: firstTermEnd
            })
        );
        assertTrue(clone != elections, "a clone of its own");
        address[] memory winners = new address[](1);
        winners[0] = address(jordanSafe);
        IInstaller.ElectionsInstall memory p = IInstaller.ElectionsInstall({
            safe: address(companySafe),
            money: d,
            directorHat: seriesA,
            elections: clone,
            firstTermEnd: firstTermEnd,
            winners: winners,
            seats: 2,
            threshold: _threshold(2, 3)
        });
        IInstaller.Call[] memory calls = installer.buildElections(p);

        // it should elect and mint for that hat only
        assertEq(calls[0].to, clone, "elect on the group's clone");
        _assertHas(
            calls,
            Addresses.HATS,
            abi.encodeCall(IHats.changeHatEligibility, (seriesA, clone)),
            "attach to the Series A hat"
        );
        _assertHas(
            calls, Addresses.HATS, abi.encodeCall(IHats.mintHat, (seriesA, address(jordanSafe))), "Jordan seated"
        );
        assertEq(_countSelector(calls, Addresses.HATS, IHats.checkHatWearerStatus.selector), 0, "no Series A wearer");
        assertEq(_countSelector(calls, Addresses.HATS, IHats.changeHatMaxSupply.selector), 0, "two seats already");
        for (uint256 i; i < calls.length; ++i) {
            assertTrue(calls[i].to != elections, "the first group's clone untouched");
            assertTrue(
                keccak256(calls[i].data) != keccak256(abi.encodeCall(IHats.mintHat, (d.directorHat, winners[0]))),
                "no mint of the first group's hat"
            );
        }

        _runAs(address(founderSafe), calls);
        assertTrue(_isWearer(address(jordanSafe), seriesA), "Jordan wears the Series A hat");
        assertFalse(_isWearer(address(jordanSafe), d.directorHat), "not the first group's");
        assertTrue(_isWearer(address(benSafe), d.directorHat), "Ben keeps the first group's seat");
        vm.prank(users.eve);
        _gateView().claimSignerFor(seriesA, address(jordanSafe));
        assertTrue(companySafe.isOwner(address(jordanSafe)), "a signer through the second signer hat");
        assertEq(companySafe.getThreshold(), _required(_threshold(2, 3), 3), "threshold from the new config");
    }

    function test_GivenTheGovernorExecutesThem() external whenTheInputsAreValid elected {
        IInstaller.ElectionsInstall memory p = _electionsInstall(3);
        _runAs(address(founderSafe), installer.buildElections(p));
        assertTrue(_isWearer(address(jordanSafe), d.directorHat), "Jordan wears the Director hat");
        assertFalse(_isWearer(address(benSafe), d.directorHat), "Ben no longer does");
        assertTrue(_isWearer(address(founderSafe), d.directorHat), "Amira still does");

        // it should let anyone claim each new winner as signer
        vm.prank(users.eve);
        _gateView().claimSignerFor(d.directorHat, address(jordanSafe));
        assertTrue(companySafe.isOwner(address(jordanSafe)), "Jordan's Safe is an owner");

        // it should let anyone remove each unelected former Director
        vm.prank(users.eve);
        _gateView().removeSigner(address(benSafe));
        assertFalse(companySafe.isOwner(address(benSafe)), "Ben's Safe is not an owner");

        address[] memory owners = companySafe.getOwners();
        assertEq(owners.length, 2, "Amira and Jordan");
        assertEq(companySafe.getThreshold(), _required(p.threshold, 2), "threshold from the new config");
        _assertGateIsOnlyModuleAndGuard();
    }

    function _args(bytes memory data) internal pure returns (bytes memory out) {
        out = new bytes(data.length - 4);
        for (uint256 i; i < out.length; ++i) {
            out[i] = data[i + 4];
        }
    }
}
