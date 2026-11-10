// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Addresses } from "../../../../fork/Addresses.sol";
import { IInstaller } from "../../../../../src/interfaces/IInstaller.sol";
import { IHats } from "../../../../../src/interfaces/external/IHats.sol";
import { IRoles } from "../../../../../src/interfaces/external/IRoles.sol";
import { Installer_Fork_Base } from "../../../../utils/Installer/Installer_Fork_Base.sol";

/// @notice J12 and B10: resizing one token's payout ceiling keeps what was spent this period and every other token's
/// allowance.
contract BuildSetCeiling_Installer_Unit_Concrete_Test is Installer_Fork_Base {
    IInstaller.MoneyDeployment internal d;

    function _refused(IInstaller.InstallRefusal reason) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IInstaller.InvalidInstall.selector, reason);
    }

    /// @dev USDC 10,000 and DAI 5,000 a month for Operations; Jordan runs Operations and has spent 4,000 USDC.
    modifier installed() {
        d = _deployMoney();
        IInstaller.MoneyInstall memory p = _moneyInstall(d);
        p.tokens = new IInstaller.Token[](2);
        // Top budgets far above the ceilings, so Roles' ceiling is what refuses a spend.
        p.tokens[0] = _token(address(usdc), 10_000e6, BUDGET_MONTH, d.officerHats[1]);
        p.tokens[0].topAmount = 1_000_000e6;
        p.tokens[1] = _token(address(dai), 5000 ether, BUDGET_MONTH, d.officerHats[1]);
        p.tokens[1].topAmount = 1_000_000 ether;
        _ownersBatch(installer.buildMoney(p));
        Call[] memory mint = new Call[](1);
        mint[0] = Call(Addresses.HATS, 0, abi.encodeCall(IHats.mintHat, (d.officerHats[1], users.jordan)));
        _execApproved(address(companySafe), Addresses.MULTI_SEND_CALL_ONLY_141, _multiSend(mint), DELEGATECALL);
        vm.prank(users.jordan);
        budgetsMock.spend(0, users.alice, 4000e6, 0, keccak256("usdc invoice"), bytes32(uint256(1)));
        _;
    }

    function _set(address token, uint128 ceiling) internal view returns (IInstaller.SetCeiling memory) {
        return IInstaller.SetCeiling({ safe: address(companySafe), roles: d.roles, token: token, ceiling: ceiling });
    }

    function _allowance(address token)
        internal
        view
        returns (uint128 refill, uint128 maxRefill, uint64 period, uint128 balance)
    {
        (refill, maxRefill, period, balance,) =
            _rolesView().allowances(keccak256(abi.encodePacked("v4-payout-ceiling:", token)));
    }

    function test_WhenTheSafeIsZeroOrHasNoCode() external installed {
        // it should revert with InvalidInstall
        IInstaller.SetCeiling memory p = _set(address(usdc), 1);
        p.safe = address(0);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.SafeInvalid));
        installer.buildSetCeiling(p);
        p.safe = makeAddr("no code");
        vm.expectRevert(_refused(IInstaller.InstallRefusal.SafeInvalid));
        installer.buildSetCeiling(p);
    }

    function test_WhenTheRolesDoesNotNameTheSafe() external installed {
        // it should revert with InvalidInstall
        IInstaller.SetCeiling memory p = _set(address(usdc), 1);
        p.roles = address(0);
        vm.expectRevert(_refused(IInstaller.InstallRefusal.RolesNotForSafe));
        installer.buildSetCeiling(p);
        // Another company's Roles.
        IInstaller.MoneyDeploy memory other = _moneyDeploy();
        other.safe = address(jordanSafe);
        other.salt = bytes32(uint256(2));
        p.roles = installer.deployMoney(other).roles;
        vm.expectRevert(_refused(IInstaller.InstallRefusal.RolesNotForSafe));
        installer.buildSetCeiling(p);
    }

    function test_WhenTheTokenHasNoPayoutCeiling() external installed {
        // it should revert with InvalidInstall
        vm.expectRevert(_refused(IInstaller.InstallRefusal.TokenUnknown));
        installer.buildSetCeiling(_set(makeAddr("unknown token"), 1));
    }

    modifier whenTheInputsAreValid() {
        _;
    }

    function test_WhenTheInputsAreValid() external whenTheInputsAreValid installed {
        IInstaller.Call[] memory calls = installer.buildSetCeiling(_set(address(usdc), 20_000e6));
        assertEq(calls.length, 1, "one setAllowance");
        _ownersBatch(calls);

        // it should set the refill and max refill to the new ceiling and keep what was spent this period
        (uint128 refill, uint128 maxRefill, uint64 period, uint128 balance) = _allowance(address(usdc));
        assertEq(refill, 20_000e6, "refill");
        assertEq(maxRefill, 20_000e6, "max refill");
        assertEq(period, 31 days, "period kept");
        assertEq(balance, 16_000e6, "the 4,000 spent is still spent");

        // it should leave every other token's allowance alone
        (uint128 daiRefill, uint128 daiMax, uint64 daiPeriod, uint128 daiBalance) = _allowance(address(dai));
        assertTrue(daiRefill == 5000 ether && daiMax == 5000 ether && daiBalance == 5000 ether, "DAI untouched");
        assertEq(daiPeriod, 31 days, "DAI period");
        vm.prank(users.jordan);
        budgetsMock.spend(0, users.bob, 16_000e6, 0, keccak256("usdc more"), bytes32(uint256(2)));
        vm.prank(users.jordan);
        vm.expectPartialRevert(ROLES_CONDITION_VIOLATION);
        budgetsMock.spend(0, users.bob, 1, 0, keccak256("usdc over"), bytes32(uint256(3)));
    }

    function test_GivenTheNewCeilingIsNoMoreThanWhatWasSpent() external whenTheInputsAreValid installed {
        // it should leave a zero balance
        _ownersBatch(installer.buildSetCeiling(_set(address(usdc), 3000e6)));
        (uint128 refill, uint128 maxRefill,, uint128 balance) = _allowance(address(usdc));
        assertTrue(refill == 3000e6 && maxRefill == 3000e6, "the new ceiling");
        assertEq(balance, 0, "nothing left this period");
        vm.prank(users.jordan);
        vm.expectPartialRevert(ROLES_CONDITION_VIOLATION);
        budgetsMock.spend(0, users.bob, 1, 0, keccak256("usdc over"), bytes32(uint256(2)));
    }

    function test_GivenThePeriodHasPassed() external whenTheInputsAreValid installed {
        // it should give the new ceiling in full
        vm.warp(block.timestamp + 40 days);
        _ownersBatch(installer.buildSetCeiling(_set(address(usdc), 12_000e6)));
        (,,, uint128 balance) = _allowance(address(usdc));
        assertEq(balance, 12_000e6, "the refill is not lost");
        vm.prank(users.jordan);
        budgetsMock.spend(0, users.bob, 12_000e6, 0, keccak256("usdc new period"), bytes32(uint256(2)));
    }

    function test_GivenARefillDoesNotRestoreTheMaximum() external whenTheInputsAreValid installed {
        // it should preserve the spend left after that refill
        bytes32 key = keccak256(abi.encodePacked("v4-payout-ceiling:", address(usdc)));
        uint64 period = 31 days;
        uint64 stamp = uint64(block.timestamp - period);
        vm.mockCall(
            d.roles,
            abi.encodeWithSignature("allowances(bytes32)", key),
            abi.encode(uint128(1000e6), uint128(10_000e6), period, uint128(1000e6), stamp)
        );
        IInstaller.Call[] memory calls = installer.buildSetCeiling(_set(address(usdc), 20_000e6));
        assertEq(
            calls[0].data,
            abi.encodeCall(
                IRoles.setAllowance,
                (key, uint128(12_000e6), uint128(20_000e6), uint128(20_000e6), period, uint64(block.timestamp))
            ),
            "remaining spend carried forward"
        );
    }
}
