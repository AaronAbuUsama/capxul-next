// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Addresses } from "../../../../fork/Addresses.sol";
import { ICaptable } from "../../../../../src/interfaces/ICaptable.sol";
import { IInstaller } from "../../../../../src/interfaces/IInstaller.sol";
import { IOptions } from "../../../../../src/interfaces/IOptions.sol";
import { IVesting } from "../../../../../src/interfaces/IVesting.sol";
import { IHats } from "../../../../../src/interfaces/external/IHats.sol";
import { IHatsSignerGate } from "../../../../../src/interfaces/external/IHatsSignerGate.sol";
import { MockCaptable, MockOptions } from "../../../../utils/Installer/EquityMocks.sol";
import { Installer_Fork_Base } from "../../../../utils/Installer/Installer_Fork_Base.sol";

/// @notice spec/installer.md "Equity extras" (F4): the company Safe's equity batch, then the founder's batch that
/// hands the Shareholders' tree to the Governor.
contract BuildEquity_Installer_Unit_Concrete_Test is Installer_Fork_Base {
    function _refused(IInstaller.InstallRefusal reason) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IInstaller.InvalidInstall.selector, reason);
    }

    function test_WhenTheAddressesAreNotThisCompanysDeployedClones() external {
        // it should revert with InvalidInstall
        (IInstaller.MoneyDeployment memory d, IInstaller.EquityDeployment memory e) = _deployEquity();

        // An address the Installer never cloned.
        IInstaller.EquityInstall memory p = _equityInstall(d, e);
        p.equity.captable = makeAddr("fake Captable");
        vm.expectRevert(_refused(IInstaller.InstallRefusal.NotCompanyClones));
        installer.buildEquity(p);

        // A real clone set that Eve deployed for this Safe, mixed with the company's.
        IInstaller.EquityDeploy memory evil = _equityDeploy(d);
        evil.name = "Eve Holdings";
        vm.prank(users.eve);
        IInstaller.EquityDeployment memory other = installer.deployEquity(evil);
        p = _equityInstall(d, e);
        p.equity.governor = other.governor;
        vm.expectRevert(_refused(IInstaller.InstallRefusal.NotCompanyClones));
        installer.buildEquity(p);

        // Another company's clones.
        p = _equityInstall(d, e);
        p.safe = address(jordanSafe);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.NotCompanyClones));
        installer.buildEquity(p);
    }

    modifier whenTheInstallIsValid() {
        _;
    }

    function test_WhenTheInstallIsValid() external whenTheInstallIsValid {
        (IInstaller.MoneyDeployment memory d, IInstaller.EquityDeployment memory e) = _deployEquity();
        IInstaller.EquityInstall memory p = _equityInstall(d, e);
        (IInstaller.Call[] memory safeCalls, IInstaller.Call[] memory founderCalls) = installer.buildEquity(p);
        IInstaller.FounderShares memory amira = p.founders[0];
        IInstaller.FounderShares memory ben = p.founders[1];

        // it should return Safe calls that issue the founders' shares and set the option pool
        _assertHas(
            safeCalls,
            e.captable,
            abi.encodeCall(ICaptable.issue, (ben.classId, ben.shareholder, ben.amount, ben.documentHash)),
            "Ben's unvested shares issued by the Safe"
        );
        uint256 poolAllowance =
            _find(safeCalls, e.captable, abi.encodeCall(ICaptable.setIssuerAllowance, (e.options, 0, p.optionPool)));
        uint256 setPool = _find(safeCalls, e.options, abi.encodeCall(IOptions.setPool, (p.optionPool)));
        assertTrue(poolAllowance != type(uint256).max, "Options' issuer allowance is the pool");
        assertTrue(setPool != type(uint256).max, "the option pool");

        // it should return Safe calls that grant founder vesting
        uint256 grant = _find(
            safeCalls,
            address(vestingMock),
            abi.encodeCall(
                IVesting.grantAndIssue,
                (
                    e.captable,
                    amira.classId,
                    amira.shareholder,
                    amira.amount,
                    amira.start,
                    amira.cliff,
                    amira.end,
                    amira.accelerateOnExit,
                    amira.documentHash
                )
            )
        );
        assertTrue(grant != type(uint256).max, "Amira's vesting grant");
        uint256 vestingAllowance = _findSelector(safeCalls, e.captable, ICaptable.setIssuerAllowance.selector);
        bool allowanceBeforeGrant;
        for (uint256 i; i < grant; ++i) {
            if (
                safeCalls[i].to == e.captable && bytes4(safeCalls[i].data) == ICaptable.setIssuerAllowance.selector
                    && keccak256(safeCalls[i].data)
                        == keccak256(
                            abi.encodeCall(ICaptable.setIssuerAllowance, (address(vestingMock), 0, amira.amount))
                        )
            ) allowanceBeforeGrant = true;
        }
        assertTrue(vestingAllowance != type(uint256).max, "an issuer allowance is set");
        assertTrue(allowanceBeforeGrant, "Vesting may issue exactly the grant, set before it");
        assertEq(
            _countSelector(safeCalls, address(vestingMock), IVesting.grantAndIssue.selector), 1, "only Amira vests"
        );
        for (uint256 i; i < safeCalls.length; ++i) {
            assertTrue(safeCalls[i].to != address(companySafe), "no Safe call targets the Safe");
            assertTrue(safeCalls[i].to != Addresses.HATS, "the Safe never touches the Shareholders' tree");
        }

        // it should return founder calls that hand the Director hat's eligibility and toggle to the Governor
        _assertHas(
            founderCalls,
            Addresses.HATS,
            abi.encodeCall(IHats.changeHatEligibility, (d.directorHat, e.governor)),
            "Director eligibility to the Governor"
        );
        _assertHas(
            founderCalls,
            Addresses.HATS,
            abi.encodeCall(IHats.changeHatToggle, (d.directorHat, e.governor)),
            "Director toggle to the Governor"
        );

        // it should return a founder call that transfers the Shareholders' top hat to the Governor last
        IInstaller.Call memory last = founderCalls[founderCalls.length - 1];
        assertEq(last.to, Addresses.HATS, "last founder call to Hats");
        assertEq(
            last.data,
            abi.encodeCall(IHats.transferHat, (d.shareholdersTopHat, address(founderSafe), e.governor)),
            "transferHat(Shareholders' top hat, founder's Safe, Governor) last"
        );
        assertEq(founderCalls.length, 3, "eligibility, toggle, then the top hat");
    }

    function test_GivenTheSafeAndTheFoundersSafeExecuteThem() external whenTheInstallIsValid {
        (IInstaller.MoneyDeployment memory d, IInstaller.EquityDeployment memory e) = _deployEquity();
        IInstaller.EquityInstall memory p = _equityInstall(d, e);
        (IInstaller.Call[] memory safeCalls, IInstaller.Call[] memory founderCalls) = installer.buildEquity(p);

        _ownersBatch(safeCalls); // the Board, through the Gate
        for (uint256 i; i < founderCalls.length; ++i) {
            _personalExec(founderSafe, amiraKey, founderCalls[i].to, founderCalls[i].data);
        }

        // it should produce the template's cap table
        MockCaptable captable = MockCaptable(e.captable);
        assertEq(captable.balanceOf(0, address(founderSafe)), 6_000_000, "Amira's shares");
        assertEq(captable.balanceOf(0, address(benSafe)), 3_000_000, "Ben's shares");
        assertEq(captable.issued(0), 9_000_000, "issued");
        assertEq(MockOptions(e.options).pool(), 1_000_000, "option pool");
        assertEq(captable.issuerAllowance(e.options, 0), 1_000_000, "Options may issue the pool");
        assertEq(captable.issuerAllowance(address(vestingMock), 0), 0, "Vesting used exactly its allowance");
        assertEq(vestingMock.grantCount(), 1, "one vesting grant");
        assertEq(vestingMock.grant(0).end, p.founders[0].end, "Amira's schedule");

        // it should leave the Governor owning the Gate's settings and the Director hat
        assertTrue(_isWearer(e.governor, d.shareholdersTopHat), "the Governor wears the Shareholders' top hat");
        assertFalse(_isWearer(address(founderSafe), d.shareholdersTopHat), "Amira's Safe no longer does");
        assertTrue(HATS_V1.isAdminOfHat(e.governor, d.directorHat), "the Governor administers the Director hat");
        (,,, address eligibility, address toggle,,,,) = HATS_V1.viewHat(d.directorHat);
        assertEq(eligibility, e.governor, "Director eligibility is the Governor");
        assertEq(toggle, e.governor, "Director toggle is the Governor");
        assertTrue(gate.isValidSigner(address(founderSafe)), "the Directors still sign");

        IHatsSignerGate.ThresholdConfig memory one = _threshold(1, 1);
        vm.prank(address(founderSafe));
        vm.expectRevert(bytes4(keccak256("NotOwnerHatWearer()")));
        _gateView().setThresholdConfig(one);
        vm.prank(e.governor);
        _gateView().setThresholdConfig(one);
        assertEq(_gateView().thresholdConfig().target, 1, "the Governor sets the Gate's threshold");
    }
}
