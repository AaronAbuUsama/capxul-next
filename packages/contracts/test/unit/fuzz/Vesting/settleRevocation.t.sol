// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Vesting_Shared_Test } from "../../../utils/Vesting/Vesting_Shared_Test.sol";

/// @dev Fuzz of the settleRevocation tree: any future effective date with shares locked, settled any time later.
contract SettleRevocation_Vesting_Unit_Fuzz_Test is Vesting_Shared_Test {
    function testFuzz_BurnsWhatWasLockedAtTheEffectiveDate(uint64 effectiveAt, uint64 delay) external {
        uint256 id = _defaultGrant(users.amira);
        effectiveAt = uint64(bound(effectiveAt, _now() + 1, gEnd - 1));
        delay = uint64(bound(delay, 0, 10 * 365 days));
        uint128 lockedThen = _model(AMOUNT, gStart, gCliff, gEnd, effectiveAt);
        _revoke(id, effectiveAt);
        vm.warp(uint256(effectiveAt) + delay);
        assertEq(_locked(users.amira, _now()), lockedThen, "frozen until settled");
        vm.prank(users.eve);
        vesting.settleRevocation(id);
        assertEq(vesting.getGrant(id).burned, lockedThen, "burned");
        assertEq(_balance(users.amira), AMOUNT - lockedThen, "vested shares stay");
        assertEq(captable.issued(COMMON), AMOUNT - lockedThen, "headroom");
        assertEq(_locked(users.amira, _now()), 0, "nothing locked");
    }
}
