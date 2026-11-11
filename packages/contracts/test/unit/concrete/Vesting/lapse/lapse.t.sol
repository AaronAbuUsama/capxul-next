// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IVesting } from "../../../../../src/interfaces/IVesting.sol";
import { Vesting_Shared_Test } from "../../../../utils/Vesting/Vesting_Shared_Test.sol";

contract Lapse_Vesting_Unit_Concrete_Test is Vesting_Shared_Test {
    function _offered() internal returns (uint256 id, uint64 expiry) {
        _issue(users.ben, AMOUNT);
        id = _offer(users.ben, AMOUNT);
        expiry = vesting.getGrant(id).offerExpiresAt;
    }

    function test_WhenTheGrantDoesNotExist() external {
        // it should revert with UnknownGrant
        vm.expectRevert(abi.encodeWithSelector(IVesting.UnknownGrant.selector, 99));
        vesting.lapse(99);
    }

    function test_WhenTheGrantWasAccepted() external {
        // it should revert with GrantExists
        (uint256 id, uint64 expiry) = _offered();
        vm.prank(users.ben);
        vesting.acceptGrant(id, DOC);
        vm.warp(expiry + 1);
        vm.expectRevert(abi.encodeWithSelector(IVesting.GrantExists.selector, id));
        vesting.lapse(id);
        // A live grant made by grantAndIssue never lapses either.
        uint256 liveId = _defaultGrant(users.amira);
        vm.expectRevert(abi.encodeWithSelector(IVesting.GrantExists.selector, liveId));
        vesting.lapse(liveId);
    }

    function test_WhenTheOfferHasNotExpired() external {
        // it should revert with NotYet
        (uint256 id, uint64 expiry) = _offered();
        vm.expectRevert(abi.encodeWithSelector(IVesting.NotYet.selector, expiry));
        vesting.lapse(id);
        // The last second of the offer is still open.
        vm.warp(expiry);
        vm.expectRevert(abi.encodeWithSelector(IVesting.NotYet.selector, expiry));
        vesting.lapse(id);
    }

    function test_WhenTheOfferExpiredUnaccepted() external {
        (uint256 id, uint64 expiry) = _offered();
        vm.warp(expiry + 1);
        // it should emit OfferLapsed
        vm.expectEmit(true, true, true, true, address(vesting));
        emit IVesting.OfferLapsed(address(safe), id);
        // it should let anyone call it
        vm.prank(users.eve);
        vesting.lapse(id);
        // it should delete the offer
        vm.expectRevert(abi.encodeWithSelector(IVesting.UnknownGrant.selector, id));
        vesting.getGrant(id);
        vm.expectRevert(abi.encodeWithSelector(IVesting.UnknownGrant.selector, id));
        vm.prank(users.ben);
        vesting.acceptGrant(id, DOC);
        // it should lock nothing
        assertEq(_locked(users.ben, _now()), 0, "locked");
        assertEq(vesting.grantOf(address(captable), COMMON, users.ben), 0, "grantOf");
        assertEq(_balance(users.ben), AMOUNT, "balance");
    }
}
