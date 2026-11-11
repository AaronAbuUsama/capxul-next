// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";

import { IWaterfall } from "../../src/interfaces/IWaterfall.sol";
import { WaterfallHarness } from "../utils/Exits/WaterfallHarness.sol";

/// @notice Halmos checks for the Waterfall (gate 10; fv/halmos.md rows `check_X1_lastPayoutNoUnderflow` and
/// `check_X1_waterfallPreference`). Sizing (R4 3.7): 2 classes (Common and one preferred), 1 option group,
/// so 3 payees and at most classes + groups + 1 = 4 rounds; the per-class branch inside the round loop is
/// visited classes x rounds = 8 times on a path, so each check sets `--loop 16` and gate 10 fails on any
/// bounded path. Inputs are bounded to the storage types Exits feeds in (shares `uint128` as converted to
/// at most 2^64, money at most 2^96 units). Each check first makes one concrete call that must return the
/// right payouts (the vacuity guard), so the reverting stub fails it.
contract Waterfall_Symbolic is Test {
    WaterfallHarness internal harness;

    function setUp() public {
        harness = new WaterfallHarness();
    }

    function _inputs(
        uint64 common,
        uint64 preferred,
        uint96 preference,
        uint64 groupShares,
        uint64 strike
    )
        internal
        pure
        returns (IWaterfall.ClassInput[] memory c, IWaterfall.OptionGroup[] memory g)
    {
        c = new IWaterfall.ClassInput[](2);
        c[0] = IWaterfall.ClassInput(0, common, 0, false, 0);
        c[1] = IWaterfall.ClassInput(1, preferred, preference, false, 0);
        g = new IWaterfall.OptionGroup[](1);
        g[0] = IWaterfall.OptionGroup(groupShares, strike);
    }

    /// @dev The vacuity guard: plans/Exits.md's company. 9,000 Common, 2,000 Series A owed $2,000, 1,000
    /// options at $0.50, $23,500 of proceeds: Common $2.00 a share, A converts, the options are paid $1,500.
    function _guard() internal view {
        (IWaterfall.ClassInput[] memory c, IWaterfall.OptionGroup[] memory g) = _inputs(9000, 2000, 2000e6, 1000, 0.5e6);
        try harness.compute(23_500e6, c, g) returns (IWaterfall.Result memory r) {
            assert(r.classPayouts[0] == 18_000e6);
            assert(r.classPayouts[1] == 4000e6);
            assert(r.optionPayouts[0] == 1500e6);
            assert(r.converted[1] && r.exercised[0]);
        } catch {
            assert(false);
        }
    }

    /// @dev X1: the last payout, `proceeds - sum(others)`, never underflows: whenever the waterfall settles,
    /// the three payouts add up to the proceeds exactly; the only permitted refusal is WaterfallDidNotSettle.
    /// @custom:halmos --loop 16
    function check_X1_lastPayoutNoUnderflow(
        uint96 proceeds,
        uint64 common,
        uint64 preferred,
        uint96 preference,
        uint64 groupShares,
        uint64 strike
    )
        public
        view
    {
        _guard();
        vm.assume(common > 0 && preferred > 0);
        (IWaterfall.ClassInput[] memory c, IWaterfall.OptionGroup[] memory g) =
            _inputs(common, preferred, preference, groupShares, strike);
        try harness.compute(proceeds, c, g) returns (IWaterfall.Result memory r) {
            assert(r.classPayouts[0] + r.classPayouts[1] + r.optionPayouts[0] == proceeds);
        } catch (bytes memory err) {
            assert(bytes4(err) == IWaterfall.WaterfallDidNotSettle.selector);
        }
    }

    /// @dev X1: a non-participating class gets the larger of its preference and its as-converted share at the
    /// Common price, when the proceeds cover its preference.
    /// @custom:halmos --loop 16
    function check_X1_waterfallPreference(
        uint96 proceeds,
        uint64 common,
        uint64 preferred,
        uint96 preference,
        uint64 groupShares,
        uint64 strike
    )
        public
        view
    {
        _guard();
        vm.assume(common > 0 && preferred > 0 && proceeds >= preference);
        (IWaterfall.ClassInput[] memory c, IWaterfall.OptionGroup[] memory g) =
            _inputs(common, preferred, preference, groupShares, strike);
        try harness.compute(proceeds, c, g) returns (IWaterfall.Result memory r) {
            assert(r.classPayouts[1] >= preference);
            assert(r.classPayouts[1] >= uint256(preferred) * r.commonPrice);
        } catch (bytes memory err) {
            assert(bytes4(err) == IWaterfall.WaterfallDidNotSettle.selector);
        }
    }
}
