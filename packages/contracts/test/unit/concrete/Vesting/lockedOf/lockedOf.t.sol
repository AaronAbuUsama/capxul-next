// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Vesting_Shared_Test } from "../../../../utils/Vesting/Vesting_Shared_Test.sol";
import { VestingMathHarness } from "../../../../utils/Vesting/VestingMathHarness.sol";

/// @dev Ports Firm VestingController.t.sol:88-106 (V-4, changed to calendar-month steps with locked rounded up)
/// and 177-180 (V-12, changed: no grant reads 0). Q8, invariants V1 and V5.
contract LockedOf_Vesting_Unit_Concrete_Test is Vesting_Shared_Test {
    function test_WhenTheLockHelperReceivesAnUnacceptedOffer() external {
        // it should return zero for the offer
        VestingMathHarness harness = new VestingMathHarness();
        vm.prank(address(safe));
        uint256 id = harness.offerGrant(
            address(captable),
            COMMON,
            users.ben,
            AMOUNT,
            gStart,
            gCliff,
            gEnd,
            uint64(block.timestamp) + OFFER_WINDOW,
            true,
            DOC
        );
        assertEq(harness.exposed_lockedAt(id, gStart), 0, "unaccepted offer has no lock");
    }

    function test_WhenWholeMonthsReachTheScheduleTotal() external {
        // it should return zero rather than underflow
        VestingMathHarness harness = new VestingMathHarness();
        assertEq(harness.exposed_scheduleLocked(100, 1, 100, 50, 12, 12), 0, "fully vested");
    }

    function test_WhenTheAccountHasNoGrantOnTheClass() external {
        // it should return 0
        assertEq(_locked(users.eve, _now()), 0, "nobody");
        _defaultGrant(users.amira);
        assertEq(vesting.lockedOf(address(captable), PREFERRED, users.amira, _now()), 0, "another class");
        assertEq(vesting.lockedOf(address(0xCAFE), COMMON, users.amira, _now()), 0, "another captable");
        // Plain shares are never locked.
        _issue(users.ben, AMOUNT);
        assertEq(_locked(users.ben, _now()), 0, "plain shares");
    }

    function test_WhenTheGrantIsAnOfferThatWasNotAccepted() external {
        // it should return 0
        _issue(users.ben, AMOUNT);
        _offer(users.ben, AMOUNT);
        assertEq(_locked(users.ben, _now()), 0, "now");
        assertEq(_locked(users.ben, gCliff - 1), 0, "before the cliff");
        assertEq(_locked(users.ben, _date(2027, 6, 1)), 0, "mid schedule");
    }

    function test_WhenTheTimeIsBeforeTheCliff() external {
        // it should return the whole amount
        _defaultGrant(users.amira);
        assertEq(_locked(users.amira, gStart), AMOUNT, "at the start");
        assertEq(_locked(users.amira, _date(2026, 7, 1)), AMOUNT, "six months in");
        assertEq(_locked(users.amira, gCliff - 1), AMOUNT, "the second before the cliff");
        // Before the start too (reverse vesting set up ahead).
        uint64 start = _date(2026, 6, 1);
        _grant(users.ben, AMOUNT, start, start, _date(2027, 6, 1), false);
        assertEq(_locked(users.ben, start - 1), AMOUNT, "before the start");
    }

    modifier whenTheTimeIsAtOrAfterTheCliffAndBeforeTheEnd() {
        _;
    }

    function test_WhenTheTimeIsAtOrAfterTheCliffAndBeforeTheEnd()
        external
        whenTheTimeIsAtOrAfterTheCliffAndBeforeTheEnd
    {
        // it should return the amount minus the vested part by whole calendar months rounded down
        _defaultGrant(users.amira);
        assertEq(_locked(users.amira, gCliff), 3_600_000, "12 of 48 months");
        assertEq(_locked(users.amira, _date(2027, 6, 15)), 3_100_000, "17 of 48 months, mid month");
        assertEq(_locked(users.amira, gEnd - 1), 100_000, "47 of 48 months");
        // 1,000 shares over 48 months, 13 months in: vested floor(13,000 / 48) = 270, so 730 stay locked.
        _grant(users.ben, 1000, gStart, gStart, gEnd, false);
        assertEq(_locked(users.ben, _date(2027, 2, 1)), 730, "locked rounds up");
        assertEq(_locked(users.ben, _date(2027, 2, 1)), _model(1000, gStart, gStart, gEnd, _date(2027, 2, 1)));
    }

    function test_GivenTheTimeIsExactlyOnAMonthStep() external whenTheTimeIsAtOrAfterTheCliffAndBeforeTheEnd {
        // it should include that month in the vested part
        _defaultGrant(users.amira);
        assertEq(_locked(users.amira, _date(2027, 6, 1)), 3_100_000, "the 17th step");
        assertEq(_locked(users.amira, _date(2028, 2, 1)), 2_300_000, "the 25th step");
    }

    function test_GivenTheTimeIsTheDayBeforeAMonthStep() external whenTheTimeIsAtOrAfterTheCliffAndBeforeTheEnd {
        // it should not include that month yet
        _defaultGrant(users.amira);
        assertEq(_locked(users.amira, _date(2027, 5, 31)), 3_200_000, "the day before the 17th step");
        assertEq(_locked(users.amira, _date(2027, 6, 1) - 1), 3_200_000, "the second before it");
        assertEq(_locked(users.amira, _date(2028, 1, 31)), 2_400_000, "the day before the 25th step");
    }

    function test_GivenTheGrantStartedOnThe31st() external whenTheTimeIsAtOrAfterTheCliffAndBeforeTheEnd {
        // it should step on the last day of a 30 day month
        uint64 start = _date(2026, 1, 31);
        _grant(users.amira, 1200, start, start, _date(2027, 1, 31), false); // 12 steps of 100
        assertEq(_locked(users.amira, _date(2026, 2, 28)), 1100, "February: its last day");
        assertEq(_locked(users.amira, _date(2026, 4, 29)), 1000, "the day before April's step");
        assertEq(_locked(users.amira, _date(2026, 4, 30)), 900, "April 30th");
        assertEq(_locked(users.amira, _date(2026, 5, 30)), 900, "May 30th: May has a 31st");
        assertEq(_locked(users.amira, _date(2026, 5, 31)), 800, "May 31st");
    }

    function test_WhenTheTimeIsAtOrAfterTheEnd() external {
        // it should return 0
        _defaultGrant(users.amira);
        assertEq(_locked(users.amira, gEnd), 0, "at the end");
        assertEq(_locked(users.amira, gEnd + 1), 0, "after the end");
        assertEq(_locked(users.amira, type(uint64).max), 0, "far after");
        // All at once: cliff == end.
        _grant(users.ben, AMOUNT, gStart, gCliff, gCliff, false);
        assertEq(_locked(users.ben, gCliff - 1), AMOUNT, "before");
        assertEq(_locked(users.ben, gCliff), 0, "at once");
    }

    modifier whenTheGrantWasRevokedAndTheTimeIsAtOrAfterTheEffectiveDate() {
        _;
    }

    function test_GivenTheRevocationWasNotSettled()
        external
        whenTheGrantWasRevokedAndTheTimeIsAtOrAfterTheEffectiveDate
    {
        // it should return what was locked at the effective date
        uint256 id = _defaultGrant(users.amira);
        uint64 effectiveAt = _date(2028, 1, 1);
        _revoke(id, effectiveAt);
        assertEq(_locked(users.amira, _date(2027, 9, 1)), 2_800_000, "still vesting before");
        assertEq(_locked(users.amira, effectiveAt), 2_400_000, "at the effective date");
        assertEq(_locked(users.amira, _date(2029, 1, 1)), 2_400_000, "frozen later");
        assertEq(_locked(users.amira, gEnd + 365 days), 2_400_000, "frozen past the end");
    }

    function test_GivenTheRevocationWasSettled() external whenTheGrantWasRevokedAndTheTimeIsAtOrAfterTheEffectiveDate {
        // it should return 0
        uint256 id = _defaultGrant(users.amira);
        uint64 effectiveAt = _date(2028, 1, 1);
        _revoke(id, effectiveAt);
        vm.warp(effectiveAt);
        vesting.settleRevocation(id);
        assertEq(_locked(users.amira, effectiveAt), 0, "at the effective date");
        assertEq(_locked(users.amira, _date(2029, 1, 1)), 0, "later");
    }

    function test_GivenTheShareholderReceivedMoreSharesOfTheClass() external {
        // it should return the same locked amount
        _defaultGrant(users.amira);
        vm.warp(_date(2027, 6, 1));
        uint128 before = _locked(users.amira, _now());
        uint128 later = _locked(users.amira, _date(2028, 6, 1));
        // A new issue to her.
        _issue(users.amira, 1_000_000);
        assertEq(_locked(users.amira, _now()), before, "after an issue");
        // A transfer in from another shareholder.
        _issue(users.ben, 500_000);
        vm.prank(users.ben);
        common.transfer(users.amira, 500_000);
        assertEq(_locked(users.amira, _now()), before, "after a transfer in");
        assertEq(_locked(users.amira, _date(2028, 6, 1)), later, "the curve is unchanged");
        assertEq(_balance(users.amira), uint256(AMOUNT) + 1_500_000, "balance grew");
    }

    function test_ShouldNeverIncreaseAsTimeMovesForward() external {
        // it should never increase as time moves forward
        _defaultGrant(users.amira);
        uint128 last = type(uint128).max;
        for (uint64 t = gStart - 1 days; t <= gEnd + 31 days; t += 5 days) {
            uint128 l = _locked(users.amira, t);
            assertLe(l, last, "locked rose");
            assertEq(l, _model(AMOUNT, gStart, gCliff, gEnd, t), "model");
            last = l;
        }
    }
}
