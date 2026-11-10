// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICaptable } from "../../../../../src/interfaces/ICaptable.sol";
import { IVesting } from "../../../../../src/interfaces/IVesting.sol";
import { Vesting_Shared_Test } from "../../../../utils/Vesting/Vesting_Shared_Test.sol";

/// @dev Research R1 V-8 and V-9 (changed): the burn waits for the effective date and goes back into the
/// authorised headroom through `Captable.burnUnvested`.
contract SettleRevocation_Vesting_Unit_Concrete_Test is Vesting_Shared_Test {
    /// @dev Revoked at 1 January 2028, 24 months in: 2,400,000 shares locked then.
    uint64 internal effectiveAt;
    uint128 internal constant LOCKED_AT_EFFECTIVE = 2_400_000;

    function setUp() public override {
        super.setUp();
        effectiveAt = _date(2028, 1, 1);
    }

    function _revokedGrant() internal returns (uint256 id) {
        id = _defaultGrant(users.amira);
        _revoke(id, effectiveAt);
    }

    function test_WhenTheGrantDoesNotExist() external {
        // it should revert with UnknownGrant
        vm.expectRevert(abi.encodeWithSelector(IVesting.UnknownGrant.selector, 99));
        vesting.settleRevocation(99);
    }

    function test_WhenTheGrantIsNotRevoked() external {
        // it should revert with UnknownGrant
        uint256 id = _defaultGrant(users.amira);
        vm.warp(effectiveAt);
        vm.expectRevert(abi.encodeWithSelector(IVesting.UnknownGrant.selector, id));
        vesting.settleRevocation(id);
    }

    function test_WhenTheEffectiveDateHasNotCome() external {
        // it should revert with NotYet
        uint256 id = _revokedGrant();
        vm.warp(effectiveAt - 1);
        vm.expectRevert(abi.encodeWithSelector(IVesting.NotYet.selector, effectiveAt));
        vesting.settleRevocation(id);
    }

    function test_WhenItWasAlreadySettled() external {
        // it should do nothing
        uint256 id = _revokedGrant();
        vm.warp(effectiveAt);
        vesting.settleRevocation(id);
        bytes32 before = _grantHash(id);
        uint256 balance = _balance(users.amira);

        _expectNoIssueOrBurn();
        vm.recordLogs();
        vm.prank(users.eve);
        vesting.settleRevocation(id);
        _assertNoVestingEvent();
        assertEq(_grantHash(id), before, "grant unchanged");
        assertEq(_balance(users.amira), balance, "balance unchanged");
    }

    modifier whenTheEffectiveDateHasCome() {
        _;
    }

    function test_WhenTheEffectiveDateHasCome() external whenTheEffectiveDateHasCome {
        uint256 id = _revokedGrant();
        vm.warp(effectiveAt);
        uint256 issuedBefore = captable.issued(COMMON);

        // it should burn the shares locked at the effective date through the Captable
        vm.expectCall(
            address(captable), abi.encodeCall(ICaptable.burnUnvested, (COMMON, users.amira, LOCKED_AT_EFFECTIVE))
        );
        // it should emit RevocationSettled
        vm.expectEmit(true, true, true, true, address(vesting));
        emit IVesting.RevocationSettled(address(safe), id, LOCKED_AT_EFFECTIVE);
        // it should let anyone call it
        vm.prank(users.eve);
        vesting.settleRevocation(id);

        // it should return them to the authorised headroom
        assertEq(captable.issued(COMMON), issuedBefore - LOCKED_AT_EFFECTIVE, "issued");
        // it should leave the vested shares with the shareholder
        assertEq(_balance(users.amira), AMOUNT - LOCKED_AT_EFFECTIVE, "vested shares stay");
        assertEq(vesting.getGrant(id).burned, LOCKED_AT_EFFECTIVE, "burned");
        assertEq(_locked(users.amira, _now()), 0, "nothing locked");
    }

    function test_GivenItRunsLongAfterTheEffectiveDate() external whenTheEffectiveDateHasCome {
        uint256 id = _revokedGrant();
        // Eighteen months late: the schedule alone would have unlocked down to 600,000 by now.
        vm.warp(_date(2029, 7, 1));

        // it should have kept the shares locked from the effective date until now
        assertEq(_locked(users.amira, _now()), LOCKED_AT_EFFECTIVE, "still frozen");
        uint256 free = AMOUNT - LOCKED_AT_EFFECTIVE;
        vm.expectRevert(abi.encodeWithSelector(ICaptable.SharesLocked.selector, users.amira, LOCKED_AT_EFFECTIVE));
        vm.prank(users.amira);
        common.transfer(users.bob, free + 1);

        // it should burn only what was locked at the effective date
        vm.expectCall(
            address(captable), abi.encodeCall(ICaptable.burnUnvested, (COMMON, users.amira, LOCKED_AT_EFFECTIVE))
        );
        vesting.settleRevocation(id);
        assertEq(_balance(users.amira), free, "vested shares stay");
        assertEq(vesting.getGrant(id).burned, LOCKED_AT_EFFECTIVE, "burned");
    }
}
