// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IVesting } from "../../../../../src/interfaces/IVesting.sol";
import { Vesting_Shared_Test } from "../../../../utils/Vesting/Vesting_Shared_Test.sol";

/// @dev Ports Firm VestingController.t.sol:147-153 (V-11, anyone cleans up), 155-160 (not before the end) and
/// 162-166 (unknown).
contract Release_Vesting_Unit_Concrete_Test is Vesting_Shared_Test {
    function test_WhenTheGrantIsNotAccepted() external {
        // it should revert with NotAccepted
        _issue(users.ben, AMOUNT);
        uint256 id = _offer(users.ben, AMOUNT);
        vm.expectRevert(IVesting.NotAccepted.selector);
        vesting.release(id);
    }

    function test_WhenTheGrantDoesNotExist() external {
        // it should revert with UnknownGrant
        vm.expectRevert(abi.encodeWithSelector(IVesting.UnknownGrant.selector, 99));
        vesting.release(99);
    }

    function test_WhenTheGrantWasAlreadyReleased() external {
        uint256 id = _defaultGrant(users.amira);
        vm.warp(gEnd);
        vesting.release(id);
        uint256 next = _grant(users.amira, AMOUNT, _now(), _now() + 365 days, _now() + 4 * 365 days, false);
        uint128 locked = _locked(users.amira, _now());

        // it should revert with UnknownGrant
        vm.expectRevert(abi.encodeWithSelector(IVesting.UnknownGrant.selector, id));
        vm.prank(users.eve);
        vesting.release(id);

        // it should keep the account's next grant live and locked
        assertEq(vesting.grantOf(address(captable), COMMON, users.amira), next, "next grant dropped");
        assertEq(_locked(users.amira, _now()), locked, "lock dropped");
        assertEq(locked, AMOUNT, "next grant locks all before its cliff");
    }

    function test_WhenTheGrantHasNotEndedAndWasNotSettled() external {
        // it should revert with NotYet
        uint256 id = _defaultGrant(users.amira);
        // Ben's grant is revoked from 1 January 2028 and never settled.
        uint256 benId = _grant(users.ben, AMOUNT, gStart, gCliff, gEnd, false);
        uint64 effectiveAt = _date(2028, 1, 1);
        _revoke(benId, effectiveAt);
        vm.warp(gEnd - 1);
        vm.expectRevert(abi.encodeWithSelector(IVesting.NotYet.selector, gEnd));
        vesting.release(id);

        // A revoked grant whose revocation is not settled stays until it is, even past its end: releasing it
        // would drop the lock before the burn.
        vm.warp(gEnd + 1);
        vm.expectRevert(abi.encodeWithSelector(IVesting.NotYet.selector, effectiveAt));
        vesting.release(benId);
        assertEq(_locked(users.ben, _now()), 2_400_000, "still locked");
    }

    function test_WhenTheGrantHasEndedOrItsRevocationSettled() external {
        uint256 id = _defaultGrant(users.amira);
        vm.warp(gEnd);
        // it should emit Released
        vm.expectEmit(true, true, true, true, address(vesting));
        emit IVesting.Released(address(safe), id);
        // it should let anyone call it
        vm.prank(users.eve);
        vesting.release(id);
        // it should clear the account's grant on the class
        assertEq(vesting.grantOf(address(captable), COMMON, users.amira), 0, "grantOf");
        assertEq(_locked(users.amira, _now()), 0, "locked");
        // it should let the account receive a new grant on the class
        uint256 next = _grant(users.amira, AMOUNT, _now(), _now(), _now() + 400 days, true);
        assertEq(vesting.grantOf(address(captable), COMMON, users.amira), next, "new grant");
        assertGt(next, id, "new id");

        // A grant whose revocation is settled is released before its end.
        uint256 benId = _grant(users.ben, AMOUNT, _now(), _now() + 365 days, _now() + 4 * 365 days, false);
        _revoke(benId, _now()); // settles at once
        vm.expectEmit(true, true, true, true, address(vesting));
        emit IVesting.Released(address(safe), benId);
        vesting.release(benId);
        assertEq(vesting.grantOf(address(captable), COMMON, users.ben), 0, "ben grantOf");
    }
}
