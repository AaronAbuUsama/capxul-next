// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";

import { IWaterfall } from "../../../../src/interfaces/IWaterfall.sol";
import { WaterfallHarness, WaterfallInputs } from "../../../utils/Exits/WaterfallHarness.sol";

/// @dev Fuzz of `Waterfall.compute` (spec/exits.md; invariant X1) over three classes (Common, two preferred of
/// any seniority and participation) and two option groups. Ranges: proceeds up to 1e18 units ($1 trillion at 6
/// decimals); shares up to 1e12 per class; preference up to 1e18; strike up to 1e9 units per share.
/// A run that does not settle must revert with exactly `WaterfallDidNotSettle`.
contract Compute_Waterfall_Unit_Fuzz_Test is Test {
    using WaterfallInputs for IWaterfall.Result;

    WaterfallHarness internal wf;

    function setUp() external {
        wf = new WaterfallHarness();
    }

    struct Draw {
        uint256 proceeds;
        uint256 common;
        uint256[2] shares;
        uint256[2] prefs;
        bool[2] participating;
        uint8[2] seniority;
        uint256[2] groupShares;
        uint256[2] strikes;
    }

    function _inputs(Draw memory d)
        internal
        pure
        returns (IWaterfall.ClassInput[] memory c, IWaterfall.OptionGroup[] memory g)
    {
        d.proceeds = bound(d.proceeds, 0, 1e18);
        c = new IWaterfall.ClassInput[](3);
        c[0] = WaterfallInputs.cls(0, bound(d.common, 1, 1e12), 0, false, 0);
        g = new IWaterfall.OptionGroup[](2);
        for (uint256 i; i < 2; ++i) {
            c[i + 1] = WaterfallInputs.cls(
                uint8(i + 1),
                bound(d.shares[i], 1, 1e12),
                bound(d.prefs[i], 0, 1e18),
                d.participating[i],
                uint8(bound(d.seniority[i], 0, 3))
            );
            g[i] = IWaterfall.OptionGroup(bound(d.groupShares[i], 0, 1e10), bound(d.strikes[i], 0, 1e9));
        }
    }

    function _compute(
        uint256 proceeds,
        IWaterfall.ClassInput[] memory c,
        IWaterfall.OptionGroup[] memory g
    )
        internal
        view
        returns (bool settled, IWaterfall.Result memory r)
    {
        try wf.compute(proceeds, c, g) returns (IWaterfall.Result memory res) {
            return (true, res);
        } catch (bytes memory err) {
            assertEq(bytes4(err), IWaterfall.WaterfallDidNotSettle.selector, "only WaterfallDidNotSettle");
        }
    }

    /// @dev X1: payouts add up to the proceeds exactly, one per input.
    function testFuzz_X1_PayoutsAddUpToTheProceeds(Draw memory d) external view {
        (IWaterfall.ClassInput[] memory c, IWaterfall.OptionGroup[] memory g) = _inputs(d);
        (bool settled, IWaterfall.Result memory r) = _compute(d.proceeds, c, g);
        if (!settled) return;
        assertEq(r.classPayouts.length, 3, "a payout per class");
        assertEq(r.optionPayouts.length, 2, "a payout per group");
        assertEq(r.total(), d.proceeds, "sums to the proceeds exactly");
    }

    /// @dev When the proceeds cover every preference, every preferred class gets at least its preference, a
    /// non-participating one the larger of it and its as-converted value at the Common price, and an option
    /// group is paid only when exercised.
    function testFuzz_X1_PreferencesFirstWhenCovered(Draw memory d) external view {
        (IWaterfall.ClassInput[] memory c, IWaterfall.OptionGroup[] memory g) = _inputs(d);
        d.proceeds = bound(d.proceeds, c[1].preference + c[2].preference, 1e19);
        (bool settled, IWaterfall.Result memory r) = _compute(d.proceeds, c, g);
        if (!settled) return;
        for (uint256 i = 1; i < 3; ++i) {
            assertGe(r.classPayouts[i], c[i].preference, "at least its preference");
            if (!c[i].participating) {
                assertGe(r.classPayouts[i], c[i].asConvertedShares * r.commonPrice, "at least as converted");
            }
        }
        for (uint256 j; j < 2; ++j) {
            if (!r.exercised[j]) assertEq(r.optionPayouts[j], 0, "unexercised paid nothing");
            else assertGt(r.commonPrice, g[j].strike, "exercised only in the money");
        }
    }

    /// @dev When the proceeds do not cover the preferences, Common and options get nothing.
    function testFuzz_CommonNothingWhenPreferencesUncovered(Draw memory d) external view {
        (IWaterfall.ClassInput[] memory c, IWaterfall.OptionGroup[] memory g) = _inputs(d);
        uint256 prefs = c[1].preference + c[2].preference;
        vm.assume(prefs > 1);
        d.proceeds = bound(d.proceeds, 0, prefs - 1);
        (bool settled, IWaterfall.Result memory r) = _compute(d.proceeds, c, g);
        if (!settled) return;
        assertEq(r.commonPrice, 0, "no Common price");
        assertEq(r.optionPayouts[0] + r.optionPayouts[1], 0, "options nothing");
        assertEq(r.total(), d.proceeds, "all to the preferences");
    }

    /// @dev The exact mode: inputs above the small bounds (proceeds and preferences to 2^120, shares to 2^100,
    /// strikes to 2^80) take the checked, full-precision path. Payouts still add up to the proceeds exactly, the
    /// only refusal is `WaterfallDidNotSettle`, and covered preferences are paid in full.
    function testFuzz_X1_ExactModeForLargeInputs(Draw memory d) external view {
        IWaterfall.ClassInput[] memory c = new IWaterfall.ClassInput[](3);
        IWaterfall.OptionGroup[] memory g = new IWaterfall.OptionGroup[](2);
        c[0] = WaterfallInputs.cls(0, bound(d.common, 1, 2 ** 100), 0, false, 0);
        for (uint256 i; i < 2; ++i) {
            c[i + 1] = WaterfallInputs.cls(
                uint8(i + 1),
                bound(d.shares[i], 1, 2 ** 100),
                bound(d.prefs[i], 0, 2 ** 120),
                d.participating[i],
                uint8(bound(d.seniority[i], 0, 3))
            );
            g[i] = IWaterfall.OptionGroup(bound(d.groupShares[i], 0, 2 ** 100), bound(d.strikes[i], 0, 2 ** 80));
        }
        // At least one input above the small bounds, so the exact mode runs.
        d.proceeds = bound(d.proceeds, uint256(type(uint96).max) + 1, 2 ** 120);
        (bool settled, IWaterfall.Result memory r) = _compute(d.proceeds, c, g);
        if (!settled) return;
        assertEq(r.total(), d.proceeds, "sums to the proceeds exactly");
        if (d.proceeds >= c[1].preference + c[2].preference) {
            for (uint256 i = 1; i < 3; ++i) {
                assertGe(r.classPayouts[i], c[i].preference, "at least its preference");
            }
        }
    }
}
