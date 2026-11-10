// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IVesting } from "../../../../src/interfaces/IVesting.sol";
import { Vesting_Shared_Test } from "../../../utils/Vesting/Vesting_Shared_Test.sol";

/// @dev Fuzz of the offerGrant tree (ruling D4): any valid offer locks nothing at any time.
contract OfferGrant_Vesting_Unit_Fuzz_Test is Vesting_Shared_Test {
    function testFuzz_OfferLocksNothing(
        uint128 amount,
        uint256 startSeed,
        uint256 cliffSeed,
        uint256 endSeed,
        uint64 window,
        uint64 t
    )
        external
    {
        amount = uint128(bound(amount, 1, AUTHORISED));
        (uint64 start, uint64 cliff, uint64 end) = _boundSchedule(startSeed, cliffSeed, endSeed);
        window = uint64(bound(window, 1, 365 days));
        _issue(users.ben, amount);
        vm.prank(address(safe));
        uint256 id = vesting.offerGrant(
            address(captable), COMMON, users.ben, amount, start, cliff, end, _now() + window, true, DOC
        );
        assertFalse(vesting.getGrant(id).accepted, "accepted");
        assertEq(_locked(users.ben, t), 0, "locked");
        assertEq(vesting.grantOf(address(captable), COMMON, users.ben), 0, "grantOf");
        assertEq(_balance(users.ben), amount, "balance");
    }

    function testFuzz_RevertWhen_ExpiryIsNotInTheFuture(uint64 expiry) external {
        expiry = uint64(bound(expiry, 0, _now()));
        vm.expectRevert(IVesting.InvalidSchedule.selector);
        vm.prank(address(safe));
        vesting.offerGrant(address(captable), COMMON, users.ben, AMOUNT, gStart, gCliff, gEnd, expiry, true, DOC);
    }
}
