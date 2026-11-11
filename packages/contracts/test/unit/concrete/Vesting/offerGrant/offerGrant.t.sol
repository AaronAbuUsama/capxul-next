// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IVesting } from "../../../../../src/interfaces/IVesting.sol";
import { Vesting_Shared_Test } from "../../../../utils/Vesting/Vesting_Shared_Test.sol";

/// @dev Ruling D4 (research R1 N-2, V-15): a grant on shares already owned locks nothing until accepted.
contract OfferGrant_Vesting_Unit_Concrete_Test is Vesting_Shared_Test {
    function setUp() public override {
        super.setUp();
        // Ben already owns the shares the offer would put under the schedule.
        _issue(users.ben, AMOUNT);
    }

    function _offerAs(
        address caller,
        uint128 amount,
        uint64 start,
        uint64 cliff,
        uint64 end,
        uint64 expiresAt
    )
        internal
        returns (uint256 id)
    {
        vm.prank(caller);
        id = vesting.offerGrant(address(captable), COMMON, users.ben, amount, start, cliff, end, expiresAt, true, DOC);
    }

    function test_WhenTheCallerIsNotTheCaptablesSafe() external {
        // it should revert with OnlyBoard
        uint64 expiry = _now() + OFFER_WINDOW;
        vm.expectRevert(IVesting.OnlyBoard.selector);
        _offerAs(users.eve, AMOUNT, gStart, gCliff, gEnd, expiry);
        vm.expectRevert(IVesting.OnlyBoard.selector);
        _offerAs(users.ben, AMOUNT, gStart, gCliff, gEnd, expiry);
    }

    function test_WhenTheAmountIs0OrTheScheduleIsInvalid() external {
        // it should revert with InvalidSchedule
        uint64 expiry = _now() + OFFER_WINDOW;
        vm.expectRevert(IVesting.InvalidSchedule.selector);
        _offerAs(address(safe), 0, gStart, gCliff, gEnd, expiry);
        vm.expectRevert(IVesting.InvalidSchedule.selector);
        _offerAs(address(safe), AMOUNT, gCliff, gStart, gEnd, expiry);
        vm.expectRevert(IVesting.InvalidSchedule.selector);
        _offerAs(address(safe), AMOUNT, gStart, gEnd + 1, gEnd, expiry);
        vm.expectRevert(IVesting.InvalidSchedule.selector);
        _offerAs(address(safe), AMOUNT, gStart, gStart, _date(2026, 1, 20), expiry);
    }

    function test_WhenTheOfferExpiryIsNotInTheFuture() external {
        // it should revert with InvalidSchedule
        vm.expectRevert(IVesting.InvalidSchedule.selector);
        _offerAs(address(safe), AMOUNT, gStart, gCliff, gEnd, _now());
        vm.expectRevert(IVesting.InvalidSchedule.selector);
        _offerAs(address(safe), AMOUNT, gStart, gCliff, gEnd, _now() - 1);
        vm.expectRevert(IVesting.InvalidSchedule.selector);
        _offerAs(address(safe), AMOUNT, gStart, gCliff, gEnd, 0);
    }

    function test_WhenTheOfferIsValid() external {
        uint64 expiry = _now() + OFFER_WINDOW;
        IVesting.Grant memory expected = IVesting.Grant({
            captable: address(captable),
            classId: COMMON,
            shareholder: users.ben,
            amount: AMOUNT,
            start: gStart,
            cliff: gCliff,
            end: gEnd,
            offerExpiresAt: expiry,
            revokedAt: 0,
            burned: 0,
            accepted: false,
            accelerateOnExit: true,
            documentHash: DOC
        });
        // it should issue no shares
        _expectNoIssueOrBurn();
        // it should emit GrantOffered
        vm.expectEmit(true, true, true, true, address(vesting));
        emit IVesting.GrantOffered(address(safe), 1, users.ben, expected);
        uint256 id = _offerAs(address(safe), AMOUNT, gStart, gCliff, gEnd, expiry);

        // it should record an offer that is not accepted
        assertEq(id, 1, "id");
        _assertGrant(vesting.getGrant(id), expected);
        assertEq(_balance(users.ben), AMOUNT, "balance unchanged");
        assertEq(captable.issued(COMMON), AMOUNT, "issued unchanged");
        // it should lock nothing before the shareholder accepts
        assertEq(_locked(users.ben, _now()), 0, "locked now");
        assertEq(_locked(users.ben, gCliff - 1), 0, "locked before the cliff");
        // it should not set the shareholder's live grant on the class
        assertEq(vesting.grantOf(address(captable), COMMON, users.ben), 0, "grantOf");
        // Ben can still move every share.
        vm.prank(users.ben);
        common.transfer(users.bob, AMOUNT);
        assertEq(_balance(users.bob), AMOUNT, "moved");
    }
}
