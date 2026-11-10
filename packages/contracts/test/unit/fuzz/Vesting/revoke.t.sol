// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IVesting } from "../../../../src/interfaces/IVesting.sol";
import { Vesting_Shared_Test } from "../../../utils/Vesting/Vesting_Shared_Test.sol";

/// @dev Fuzz of the revoke tree (V3, V-6, V-7): any moment of the grant, any effective date a year either side.
contract Revoke_Vesting_Unit_Fuzz_Test is Vesting_Shared_Test {
    function testFuzz_EffectiveDate(uint64 at, uint64 effectiveAt, bool now_) external {
        uint256 id = _defaultGrant(users.amira);
        at = uint64(bound(at, gStart, gEnd + 365 days));
        vm.warp(at);
        effectiveAt = now_ ? at : uint64(bound(effectiveAt, at - 365 days, at + 365 days));
        uint128 lockedThen = _model(AMOUNT, gStart, gCliff, gEnd, effectiveAt);
        if (effectiveAt < at) {
            vm.expectRevert(IVesting.RevokeInPast.selector);
            _revoke(id, effectiveAt);
            return;
        }
        if (lockedThen == 0) {
            vm.expectRevert(IVesting.FullyVested.selector);
            _revoke(id, effectiveAt);
            return;
        }
        _revoke(id, effectiveAt);
        IVesting.Grant memory g = vesting.getGrant(id);
        assertEq(g.revokedAt, effectiveAt, "revokedAt");
        assertGe(g.revokedAt, at, "never in the past");
        assertEq(g.burned, effectiveAt == at ? lockedThen : 0, "burned");
        assertEq(_balance(users.amira), effectiveAt == at ? AMOUNT - lockedThen : AMOUNT, "balance");
    }
}
