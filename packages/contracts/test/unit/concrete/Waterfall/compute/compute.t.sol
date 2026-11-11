// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";

import { IWaterfall } from "../../../../../src/interfaces/IWaterfall.sol";
import { WaterfallHarness, WaterfallInputs } from "../../../../utils/Exits/WaterfallHarness.sol";

/// @dev spec/exits.md "Waterfall": the iteration (exercise every group, convert nothing, pay preferences by
/// seniority, price Common, re-decide until stable), rounding down with the remainder to the last payee (X1).
/// Inputs are plain integers (token units and whole shares); each case is chosen so the exact answer is whole.
contract Compute_Waterfall_Unit_Concrete_Test is Test {
    using WaterfallInputs for IWaterfall.Result;

    WaterfallHarness internal wf;

    function setUp() external {
        wf = new WaterfallHarness();
    }

    function _classes(uint256 n) internal pure returns (IWaterfall.ClassInput[] memory) {
        return new IWaterfall.ClassInput[](n);
    }

    function _groups(uint256 n) internal pure returns (IWaterfall.OptionGroup[] memory) {
        return new IWaterfall.OptionGroup[](n);
    }

    function test_WhenTheProceedsAre0() external view {
        // it should pay nobody
        IWaterfall.ClassInput[] memory c = _classes(2);
        c[0] = WaterfallInputs.cls(0, 1000, 0, false, 0);
        c[1] = WaterfallInputs.cls(1, 500, 2000, false, 0);
        IWaterfall.OptionGroup[] memory g = _groups(1);
        g[0] = IWaterfall.OptionGroup(100, 1);

        IWaterfall.Result memory r = wf.compute(0, c, g);

        assertEq(r.classPayouts.length, 2, "one payout per class");
        assertEq(r.optionPayouts.length, 1, "one payout per group");
        assertEq(r.classPayouts[0], 0, "Common paid nothing");
        assertEq(r.classPayouts[1], 0, "preferred paid nothing");
        assertEq(r.optionPayouts[0], 0, "options paid nothing");
        assertFalse(r.exercised[0], "no option is in the money at price 0");
        assertEq(r.commonPrice, 0, "price 0");
    }

    function test_WhenInputsExceedTheSmallArithmeticBounds() external view {
        // it should preserve every unit and convert a valuable preferred class
        IWaterfall.ClassInput[] memory c = _classes(2);
        c[0] = WaterfallInputs.cls(0, 2 ** 65, 0, false, 0);
        c[1] = WaterfallInputs.cls(1, 2 ** 65, 2 ** 65, false, 0);
        IWaterfall.OptionGroup[] memory g = _groups(1);
        g[0] = IWaterfall.OptionGroup(2 ** 64, 1);
        uint256 proceeds = 2 ** 100;

        IWaterfall.Result memory r = wf.compute(proceeds, c, g);

        assertEq(r.total(), proceeds, "all proceeds paid");
        assertTrue(r.converted[1], "valuable preferred converts");
        assertTrue(r.exercised[0], "in-the-money options exercise");
    }

    function test_WhenLargeProceedsHaveNoShares() external view {
        // it should pay the remainder without dividing by zero
        IWaterfall.ClassInput[] memory c = _classes(1);
        c[0] = WaterfallInputs.cls(0, 0, 0, false, 0);
        uint256 proceeds = 2 ** 100;

        IWaterfall.Result memory r = wf.compute(proceeds, c, _groups(0));

        assertEq(r.commonPrice, 0, "no price without shares");
        assertEq(r.total(), proceeds, "remainder is paid");
    }

    function test_WhenTheProceedsDoNotCoverThePreferences() external view {
        // it should pay preferences by seniority
        // it should pay pari passu classes pro rata
        // it should pay Common nothing
        // Common first (as a Captable lists it); a senior class owed 3,000; two juniors owed 2,000 and 6,000.
        IWaterfall.ClassInput[] memory c = _classes(4);
        c[0] = WaterfallInputs.cls(0, 1000, 0, false, 0);
        c[1] = WaterfallInputs.cls(1, 100, 3000, false, 0);
        c[2] = WaterfallInputs.cls(2, 100, 2000, false, 1);
        c[3] = WaterfallInputs.cls(3, 100, 6000, false, 1);

        IWaterfall.Result memory r = wf.compute(5000, c, _groups(0));

        assertEq(r.classPayouts[1], 3000, "the senior class is paid in full first");
        assertEq(r.classPayouts[2], 500, "junior 2,000 of 8,000 gets a quarter of the 2,000 left");
        assertEq(r.classPayouts[3], 1500, "junior 6,000 of 8,000 gets three quarters");
        assertEq(r.classPayouts[0], 0, "Common gets nothing");
        assertEq(r.commonPrice, 0, "nothing per Common share");
        assertFalse(r.converted[1] || r.converted[2] || r.converted[3], "no preferred class converts");
        assertEq(r.total(), 5000, "all of it paid");
    }

    function test_WhenANonParticipatingClasssAsConvertedValueIsMoreThanItsPreference() external view {
        // it should convert it and pay it as Common
        // Round 1: preference 1,000 paid, 9,000 over 1,000 Common = 9 a share, so 1,000 preferred are worth
        // 9,000 > 1,000: convert. Round 2: 10,000 over 2,000 shares = 5; 5,000 > 1,000 still: stable.
        IWaterfall.ClassInput[] memory c = _classes(2);
        c[0] = WaterfallInputs.cls(0, 1000, 0, false, 0);
        c[1] = WaterfallInputs.cls(1, 1000, 1000, false, 0);

        IWaterfall.Result memory r = wf.compute(10_000, c, _groups(0));

        assertTrue(r.converted[1], "converted");
        assertEq(r.commonPrice, 5, "price over every as-converted share");
        assertEq(r.classPayouts[1], 5000, "paid as Common, not its preference");
        assertEq(r.classPayouts[0], 5000, "Common");
    }

    function test_WhenAParticipatingClassIsPresent() external view {
        // it should pay its preference and then its as converted share
        // Preference 1,000 first; the 2,000 left over 1,000 Common + 1,000 participating = 1 a share.
        IWaterfall.ClassInput[] memory c = _classes(2);
        c[0] = WaterfallInputs.cls(0, 1000, 0, false, 0);
        c[1] = WaterfallInputs.cls(1, 1000, 1000, true, 0);

        IWaterfall.Result memory r = wf.compute(3000, c, _groups(0));

        assertEq(r.commonPrice, 1, "price");
        assertEq(r.classPayouts[1], 2000, "1,000 preference + 1,000 x 1");
        assertEq(r.classPayouts[0], 1000, "Common");
        assertFalse(r.converted[1], "a participating class never gives up its preference");
    }

    function test_WhenAnOptionGroupsStrikeIsAtOrAboveTheCommonPrice() external view {
        // it should leave it unexercised and pay it nothing
        IWaterfall.ClassInput[] memory c = _classes(1);
        c[0] = WaterfallInputs.cls(0, 1000, 0, false, 0);
        IWaterfall.OptionGroup[] memory g = _groups(1);
        // Exercised: 5,500 over 1,100 = 5, not above a strike of 5. Unexercised: 5,000 over 1,000 = 5.
        g[0] = IWaterfall.OptionGroup(100, 5);

        IWaterfall.Result memory r = wf.compute(5000, c, g);
        assertFalse(r.exercised[0], "strike equal to the price: unexercised");
        assertEq(r.optionPayouts[0], 0, "paid nothing");
        assertEq(r.commonPrice, 5, "price without the group");
        assertEq(r.classPayouts[0], 5000, "Common takes it all");

        // Strike above the price.
        g[0] = IWaterfall.OptionGroup(100, 50);
        r = wf.compute(1000, c, g);
        assertFalse(r.exercised[0], "underwater");
        assertEq(r.optionPayouts[0], 0, "underwater paid nothing");
        assertEq(r.classPayouts[0], 1000, "Common takes it all");
    }

    function test_WhenAnOptionGroupIsInTheMoney() external view {
        // it should pay it the shares times the Common price minus the strike
        // 10,900 + 100 x 1 in strikes = 11,000 over 1,100 shares = 10 a share.
        IWaterfall.ClassInput[] memory c = _classes(1);
        c[0] = WaterfallInputs.cls(0, 1000, 0, false, 0);
        IWaterfall.OptionGroup[] memory g = _groups(1);
        g[0] = IWaterfall.OptionGroup(100, 1);

        IWaterfall.Result memory r = wf.compute(10_900, c, g);

        assertTrue(r.exercised[0], "exercised");
        assertEq(r.commonPrice, 10, "price includes the exercised shares and strikes");
        assertEq(r.optionPayouts[0], 900, "100 x (10 - 1)");
        assertEq(r.classPayouts[0], 10_000, "Common");
    }

    function test_WhenTheConversionsAndExercisesDoNotSettleWithinTheBound() external {
        // it should revert with WaterfallDidNotSettle
        // Two classes of 100 owed 100 each over one Common share, 300 of proceeds. Converting neither:
        // 100 a share, so both convert (10,000 > 100). Converting both: 300 over 201 rounds down to 1, so
        // each is worth 100, not more than 100: neither converts. It flips for ever.
        IWaterfall.ClassInput[] memory c = _classes(3);
        c[0] = WaterfallInputs.cls(0, 1, 0, false, 0);
        c[1] = WaterfallInputs.cls(1, 100, 100, false, 0);
        c[2] = WaterfallInputs.cls(2, 100, 100, false, 0);

        vm.expectRevert(IWaterfall.WaterfallDidNotSettle.selector);
        wf.compute(300, c, _groups(0));
    }

    function test_ShouldMakeEveryPayoutAddUpToTheProceedsExactly() external view {
        // it should make every payout add up to the proceeds exactly
        // 10 over 3 + 3 + 1 shares rounds down; the remainder goes to the last payee and nothing is lost.
        IWaterfall.ClassInput[] memory c = _classes(3);
        c[0] = WaterfallInputs.cls(0, 3, 0, false, 0);
        c[1] = WaterfallInputs.cls(1, 3, 0, false, 0);
        c[2] = WaterfallInputs.cls(2, 1, 0, false, 0);
        IWaterfall.OptionGroup[] memory g = _groups(0);

        IWaterfall.Result memory r = wf.compute(10, c, g);
        assertEq(r.total(), 10, "sums to the proceeds");
        assertEq(r.commonPrice, 1, "10 / 7 rounds down");
        assertGe(r.classPayouts[0], 4, "at least its floor share 3 x 10 / 7");
        assertGe(r.classPayouts[1], 4, "at least its floor share");
        assertGe(r.classPayouts[2], 1, "at least its floor share");
        assertLe(r.classPayouts[0], 5, "rounding moves at most a unit per payee");

        // A large odd case: a preferred class, Common, and an in-the-money group.
        c[0] = WaterfallInputs.cls(0, 7_777_777, 0, false, 0);
        c[1] = WaterfallInputs.cls(1, 3_333_333, 3_999_999_600_000, false, 0);
        c[2] = WaterfallInputs.cls(2, 1_111_111, 0, false, 0);
        g = _groups(1);
        g[0] = IWaterfall.OptionGroup(999_999, 123_457);
        r = wf.compute(123_456_789_012_345, c, g);
        assertEq(r.total(), 123_456_789_012_345, "sums to the proceeds exactly");
    }
}
