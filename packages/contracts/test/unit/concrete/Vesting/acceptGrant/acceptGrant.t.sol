// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICaptable } from "../../../../../src/interfaces/ICaptable.sol";
import { IVesting } from "../../../../../src/interfaces/IVesting.sol";
import { Vesting_Shared_Test } from "../../../../utils/Vesting/Vesting_Shared_Test.sol";

/// @dev Rulings D4 and F7: the shareholder's acceptance is an on-chain call from their own Safe.
contract AcceptGrant_Vesting_Unit_Concrete_Test is Vesting_Shared_Test {
    uint256 internal offerId;

    function setUp() public override {
        super.setUp();
        _issue(users.ben, AMOUNT);
        // Tried, so that on the stub each test fails on its own first call rather than in setUp.
        vm.prank(address(safe));
        try vesting.offerGrant(
            address(captable), COMMON, users.ben, AMOUNT, gStart, gCliff, gEnd, _now() + OFFER_WINDOW, true, DOC
        ) returns (
            uint256 id
        ) {
            offerId = id;
        } catch { }
    }

    function _accept(address caller, uint256 id, bytes32 terms) internal {
        vm.prank(caller);
        vesting.acceptGrant(id, terms);
    }

    function test_WhenTheGrantDoesNotExist() external {
        // it should revert with UnknownGrant
        vm.expectRevert(abi.encodeWithSelector(IVesting.UnknownGrant.selector, 99));
        _accept(users.ben, 99, DOC);
    }

    function test_WhenTheCallerIsNotTheShareholder() external {
        // it should revert with OnlyShareholder
        vm.expectRevert(IVesting.OnlyShareholder.selector);
        _accept(users.eve, offerId, DOC);
        // Not even the Board can accept for him.
        vm.expectRevert(IVesting.OnlyShareholder.selector);
        _accept(address(safe), offerId, DOC);
    }

    function test_WhenTheGrantWasAlreadyAccepted() external {
        // it should revert with GrantExists
        _accept(users.ben, offerId, DOC);
        vm.expectRevert(abi.encodeWithSelector(IVesting.GrantExists.selector, offerId));
        _accept(users.ben, offerId, DOC);
    }

    function test_WhenTheOfferHasExpired() external {
        // it should revert with OfferExpired
        vm.warp(vesting.getGrant(offerId).offerExpiresAt + 1);
        vm.expectRevert(IVesting.OfferExpired.selector);
        _accept(users.ben, offerId, DOC);
    }

    function test_WhenTheTermsHashIsNotTheDocumentHash() external {
        // it should revert with TermsMismatch
        vm.expectRevert(IVesting.TermsMismatch.selector);
        _accept(users.ben, offerId, DOC2);
        vm.expectRevert(IVesting.TermsMismatch.selector);
        _accept(users.ben, offerId, bytes32(0));
    }

    function test_WhenTheShareholderAlreadyHasALiveGrantOnThisClass() external {
        // it should revert with GrantExists
        uint256 liveId = _defaultGrant(users.ben);
        vm.expectRevert(abi.encodeWithSelector(IVesting.GrantExists.selector, liveId));
        _accept(users.ben, offerId, DOC);
    }

    function test_WhenTheShareholderHoldsFewerUnlockedSharesThanTheAmount() external {
        // it should revert with NotEnoughShares
        vm.prank(users.ben);
        common.transfer(users.bob, 1);
        vm.expectRevert(abi.encodeWithSelector(IVesting.NotEnoughShares.selector, AMOUNT - 1, AMOUNT));
        _accept(users.ben, offerId, DOC);
    }

    function test_WhenTheShareholderAcceptsTheExactTermsInTime() external {
        // On the last second of the offer.
        vm.warp(vesting.getGrant(offerId).offerExpiresAt);
        // it should emit GrantAccepted
        vm.expectEmit(true, true, true, true, address(vesting));
        emit IVesting.GrantAccepted(address(safe), offerId);
        _accept(users.ben, offerId, DOC);

        // it should mark the grant accepted
        assertTrue(vesting.getGrant(offerId).accepted, "accepted");
        // it should set the shareholder's live grant on the class
        assertEq(vesting.grantOf(address(captable), COMMON, users.ben), offerId, "grantOf");
        // it should lock by the grant's schedule from now on
        assertEq(_locked(users.ben, _now()), AMOUNT, "locked before the cliff");
        assertEq(_locked(users.ben, _date(2027, 6, 1)), 3_100_000, "locked after 17 months");
        assertEq(_locked(users.ben, gEnd), 0, "locked at the end");
        vm.expectRevert(abi.encodeWithSelector(ICaptable.SharesLocked.selector, users.ben, AMOUNT));
        vm.prank(users.ben);
        common.transfer(users.bob, 1);
    }
}
