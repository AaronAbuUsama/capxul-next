// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICaptable } from "../../../../../src/interfaces/ICaptable.sol";
import { IVesting } from "../../../../../src/interfaces/IVesting.sol";
import { Vesting_Shared_Test } from "../../../../utils/Vesting/Vesting_Shared_Test.sol";

/// @dev Ports Firm VestingController.t.sol:108-117 (V-10, now the Safe), 108-128 (V-8 changed: vesting continues
/// until the date, then burns), 130-136 (V-6/V3), 138-145 (V-7) and 182-185 (V-12).
contract Revoke_Vesting_Unit_Concrete_Test is Vesting_Shared_Test {
    function test_WhenTheCallerIsNotTheCaptablesSafe() external {
        // it should revert with OnlyBoard
        uint256 id = _defaultGrant(users.amira);
        address[3] memory callers = [address(users.eve), exits, address(users.amira)];
        for (uint256 i; i < callers.length; ++i) {
            vm.expectRevert(IVesting.OnlyBoard.selector);
            vm.prank(callers[i]);
            vesting.revoke(id, _now());
        }
    }

    function test_WhenTheGrantDoesNotExist() external {
        // it should revert with UnknownGrant
        vm.expectRevert(abi.encodeWithSelector(IVesting.UnknownGrant.selector, 99));
        _revoke(99, _now());
    }

    function test_WhenTheGrantIsAnOfferThatWasNotAccepted() external {
        // it should revert with NotAccepted
        _issue(users.ben, AMOUNT);
        uint256 id = _offer(users.ben, AMOUNT);
        vm.expectRevert(IVesting.NotAccepted.selector);
        _revoke(id, _now());
        // Ruling D4: the Board cannot take shares Ben owned without his signature.
        assertEq(_balance(users.ben), AMOUNT, "balance");
    }

    function test_WhenItWasAlreadyRevoked() external {
        // it should revert with AlreadyRevoked
        uint256 id = _defaultGrant(users.amira);
        _revoke(id, _date(2028, 1, 1));
        vm.expectRevert(IVesting.AlreadyRevoked.selector);
        _revoke(id, _date(2027, 1, 1));
    }

    function test_WhenTheEffectiveDateIsInThePast() external {
        // it should revert with RevokeInPast
        uint256 id = _defaultGrant(users.amira);
        vm.warp(gCliff);
        vm.expectRevert(IVesting.RevokeInPast.selector);
        _revoke(id, gCliff - 1);
    }

    modifier whenNothingIsLockedAtTheEffectiveDate() {
        _;
    }

    function test_GivenTheGrantHasFullyVested() external whenNothingIsLockedAtTheEffectiveDate {
        // it should revert with FullyVested
        uint256 id = _defaultGrant(users.amira);
        vm.warp(gEnd);
        vm.expectRevert(IVesting.FullyVested.selector);
        _revoke(id, gEnd);
    }

    function test_GivenTheGrantFullyVestsBeforeTheEffectiveDate() external whenNothingIsLockedAtTheEffectiveDate {
        // it should revert with FullyVested
        uint256 id = _defaultGrant(users.amira);
        vm.expectRevert(IVesting.FullyVested.selector);
        _revoke(id, gEnd);
        vm.expectRevert(IVesting.FullyVested.selector);
        _revoke(id, gEnd + 365 days);
    }

    modifier whenTheEffectiveDateIsNowOrLaterAndSharesAreLockedThen() {
        _;
    }

    function test_WhenTheEffectiveDateIsNowOrLaterAndSharesAreLockedThen()
        external
        whenTheEffectiveDateIsNowOrLaterAndSharesAreLockedThen
    {
        uint256 id = _defaultGrant(users.amira);
        uint64 effectiveAt = _date(2028, 1, 1);
        vm.warp(_date(2027, 6, 1));
        // it should emit Revoked
        vm.expectEmit(true, true, true, true, address(vesting));
        emit IVesting.Revoked(address(safe), id, effectiveAt);
        _revoke(id, effectiveAt);
        // it should record the revocation
        assertEq(vesting.getGrant(id).revokedAt, effectiveAt, "revokedAt");
        assertEq(vesting.getGrant(id).burned, 0, "nothing burned yet");
    }

    function test_GivenTheEffectiveDateIsNow() external whenTheEffectiveDateIsNowOrLaterAndSharesAreLockedThen {
        uint256 id = _defaultGrant(users.amira);
        vm.warp(gCliff);
        uint128 lockedNow = 3_600_000; // 48 - 12 months of 100,000
        // it should burn the locked shares at once through the Captable
        vm.expectCall(address(captable), abi.encodeCall(ICaptable.burnUnvested, (COMMON, users.amira, lockedNow)));
        // it should emit RevocationSettled
        vm.expectEmit(true, true, true, true, address(vesting));
        emit IVesting.Revoked(address(safe), id, gCliff);
        vm.expectEmit(true, true, true, true, address(vesting));
        emit IVesting.RevocationSettled(address(safe), id, lockedNow);
        _revoke(id, gCliff);

        assertEq(_balance(users.amira), AMOUNT - lockedNow, "vested shares stay");
        assertEq(captable.issued(COMMON), AMOUNT - lockedNow, "back into the headroom");
        assertEq(vesting.getGrant(id).revokedAt, gCliff, "revokedAt");
        assertEq(vesting.getGrant(id).burned, lockedNow, "burned");
        assertEq(_locked(users.amira, _now()), 0, "nothing left locked");
    }

    function test_GivenTheEffectiveDateIsInTheFuture() external whenTheEffectiveDateIsNowOrLaterAndSharesAreLockedThen {
        uint256 id = _defaultGrant(users.amira);
        uint64 effectiveAt = _date(2027, 6, 1);
        // it should burn nothing yet
        _expectNoIssueOrBurn();
        _revoke(id, effectiveAt);
        assertEq(_balance(users.amira), AMOUNT, "balance");
        assertEq(vesting.getGrant(id).burned, 0, "burned");
        // it should keep vesting until then
        assertEq(_locked(users.amira, gCliff - 1), AMOUNT, "before the cliff");
        assertEq(_locked(users.amira, gCliff), 3_600_000, "at the cliff");
        assertEq(_locked(users.amira, _date(2027, 3, 1)), 3_400_000, "after 14 months");
        assertEq(_locked(users.amira, effectiveAt), 3_100_000, "frozen from the effective date");
        assertEq(_locked(users.amira, gEnd), 3_100_000, "still frozen at the old end");
    }
}
