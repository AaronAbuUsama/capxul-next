// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IInstaller } from "../../../../src/interfaces/IInstaller.sol";
import { IRoles } from "../../../../src/interfaces/external/IRoles.sol";
import { Installer_Hermetic_Base } from "../../../utils/Installer/Installer_Hermetic_Base.sol";
import { RolesStub } from "../../../utils/Installer/HermeticStubs.sol";

/// @notice buildSetCeiling's maths over its input ranges (trees/Installer/buildSetCeiling.tree): the new balance is the
/// new ceiling less what was spent this period, never above the ceiling, and a due refill is not lost.
contract BuildSetCeiling_Installer_Unit_Fuzz_Test is Installer_Hermetic_Base {
    address internal token = address(0xD1);

    function _set(uint128 ceiling) internal view returns (IInstaller.SetCeiling memory) {
        return IInstaller.SetCeiling({
            safe: address(companySafe), roles: address(rolesStub), token: token, ceiling: ceiling
        });
    }

    function _decode(IInstaller.Call[] memory calls)
        internal
        view
        returns (uint128 balance, uint128 maxRefill, uint128 refill, uint64 period, uint64 timestamp)
    {
        assertEq(calls.length, 1, "one call");
        assertEq(calls[0].to, address(rolesStub), "to Roles");
        assertEq(bytes4(calls[0].data), IRoles.setAllowance.selector, "setAllowance");
        bytes memory args = new bytes(calls[0].data.length - 4);
        for (uint256 i; i < args.length; ++i) {
            args[i] = calls[0].data[i + 4];
        }
        bytes32 key;
        (key, balance, maxRefill, refill, period, timestamp) =
            abi.decode(args, (bytes32, uint128, uint128, uint128, uint64, uint64));
        assertEq(key, installer.payoutAllowanceKey(token), "this token's key");
    }

    /// @dev Inside the period: the balance is the ceiling less the spend (0 if the spend is the ceiling or more).
    function testFuzz_KeepsWhatWasSpentInThePeriod(uint128 old, uint128 left, uint128 ceiling, uint64 period) external {
        old = uint128(bound(old, 1, type(uint128).max));
        left = uint128(bound(left, 0, old));
        period = uint64(bound(period, 1 days, 366 days));
        uint64 stamp = uint64(vm.getBlockTimestamp());
        rolesStub.setAllowanceStub(
            installer.payoutAllowanceKey(token),
            RolesStub.Allowance({ refill: old, maxRefill: old, period: period, balance: left, timestamp: stamp })
        );
        (uint128 balance, uint128 maxRefill, uint128 refill, uint64 p, uint64 ts) =
            _decode(installer.buildSetCeiling(_set(ceiling)));
        uint128 spent = old - left;
        assertEq(balance, spent >= ceiling ? 0 : ceiling - spent, "the ceiling less the spend");
        assertLe(balance, ceiling, "never above the ceiling");
        assertTrue(maxRefill == ceiling && refill == ceiling, "refill and max refill are the ceiling");
        assertTrue(p == period && ts == stamp, "period and start kept");
    }

    /// @dev A refill that is due is not lost: with refill = max refill one elapsed period restores the full ceiling.
    function testFuzz_ADueRefillIsKept(
        uint128 old,
        uint128 left,
        uint128 ceiling,
        uint64 period,
        uint64 late
    )
        external
    {
        old = uint128(bound(old, 1, type(uint128).max));
        left = uint128(bound(left, 0, old));
        period = uint64(bound(period, 1 days, 366 days));
        vm.warp(3000 days);
        uint64 stamp = uint64(vm.getBlockTimestamp() - period - bound(late, 0, 5 * 366 days));
        rolesStub.setAllowanceStub(
            installer.payoutAllowanceKey(token),
            RolesStub.Allowance({ refill: old, maxRefill: old, period: period, balance: left, timestamp: stamp })
        );
        (uint128 balance,,, uint64 p, uint64 ts) = _decode(installer.buildSetCeiling(_set(ceiling)));
        assertEq(balance, ceiling, "the new ceiling in full");
        assertEq(p, period, "period kept");
        assertTrue(ts > stamp && ts <= vm.getBlockTimestamp(), "start moved up to the current period");
        assertEq((ts - stamp) % period, 0, "by whole periods");
    }

    function testFuzz_RevertWhen_TheTokenHasNoCeiling(address other) external {
        vm.assume(other != token);
        IInstaller.SetCeiling memory p = _set(1);
        p.token = other;
        vm.expectRevert(_refused(IInstaller.InstallRefusal.TokenUnknown));
        installer.buildSetCeiling(p);
    }
}
