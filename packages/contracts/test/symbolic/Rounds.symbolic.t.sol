// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";

import { RoundsMathHarness } from "../utils/Rounds/RoundsMathHarness.sol";

/// @notice Halmos checks for Rounds (gate 10; fv/halmos.md rows R1, R4 and E4). They prove the round maths in
/// isolation, through `RoundsMathHarness`: the exact pay amount (R1, ruling D14), the SAFE conversion price and
/// floor (R4), and the broad-based weighted average (E4). Each check first makes concrete calls that must return
/// the right value (the vacuity guard), so the reverting stub fails it.
contract Rounds_Symbolic is Test {
    RoundsMathHarness internal harness;

    function setUp() public {
        harness = new RoundsMathHarness();
    }

    /// @dev The vacuity guard, with the unit tests' numbers: 4,000,000 shares at $2.3724 pay $9,489,600; the
    /// pre-seed SAFE converts at the $1.00 cap price into 250,000 shares; at a 20% discount the price is $0.91304
    /// and $250,000 buys 273,810; Series A's $2.5103 falls to $2.490599 after 4,000,000 shares at $2.3724 with
    /// A = 24,000,000, and is unchanged by a round above it.
    function _guard() internal view {
        try harness.exposed_payAmount(4_000_000, 2_372_400) returns (uint256 amount) {
            assert(amount == 9_489_600_000_000);
        } catch {
            assert(false);
        }
        try harness.exposed_conversionPrice(10_000_000e6, 10_000_000, 1_141_300, 0) returns (uint256 p) {
            assert(p == 1_000_000);
        } catch {
            assert(false);
        }
        try harness.exposed_conversionPrice(10_000_000e6, 10_000_000, 1_141_300, 2000) returns (uint256 p) {
            assert(p == 913_040);
        } catch {
            assert(false);
        }
        try harness.exposed_conversionShares(250_000e6, 913_040) returns (uint256 shares) {
            assert(shares == 273_810);
        } catch {
            assert(false);
        }
        try harness.exposed_antiDilutedPrice(2_510_300, 2_372_400, 24_000_000, 4_000_000) returns (uint128 cp2) {
            assert(cp2 == 2_490_599);
        } catch {
            assert(false);
        }
        try harness.exposed_antiDilutedPrice(2_510_300, 3_000_000, 24_000_000, 4_000_000) returns (uint128 cp2) {
            assert(cp2 == 2_510_300);
        } catch {
            assert(false);
        }
    }

    /// @dev R1 (ruling D14): for every `uint128` shares and price the amount is exactly `shares * price` and the call
    /// never reverts. The product cannot overflow, since (2^128 - 1)^2 < 2^256, and the unit leaf at the largest
    /// `uint128` shows it concretely. Both sides multiply unchecked: yices cannot decide checked multiplication's
    /// division-based overflow test in time.
    function check_R1_payIsExact(uint128 shares, uint128 price) public view {
        _guard();
        try harness.exposed_payAmount(shares, price) returns (uint256 amount) {
            uint256 expected;
            unchecked {
                expected = uint256(shares) * uint256(price); // < 2^256: the operands are uint128
            }
            assert(amount == expected);
        } catch {
            assert(false);
        }
    }

    /// @dev R4: a note's shares are `floor(amount / price)`, the EVM's rounding-down division and nothing else (not
    /// rounded up, not to the nearest), for every `uint128` amount and nonzero price. That `shares * price <= amount <
    /// (shares + 1) * price` and the dust is under one price is the definition of `DIV`; the fuzz test
    /// `testFuzz_ConvertSafes` asserts both inequalities over the full range (yices, CI's solver, cannot decide them
    /// for symbolic 256-bit division within the gate: the plan's judgement call).
    function check_R4_safeConversionFloor(uint128 amount, uint128 price) public view {
        _guard();
        vm.assume(price > 0);
        try harness.exposed_conversionShares(amount, price) returns (uint256 shares) {
            assert(shares == uint256(amount) / uint256(price));
        } catch {
            assert(false);
        }
    }

    /// @dev R4: the conversion price is the lower of the cap price `valuationCap / companyCapitalization` and the
    /// discounted round price `price * (10,000 - discountBps) / 10,000`, each rounded down.
    function check_R4_conversionPriceIsTheLower(
        uint128 cap,
        uint64 capitalization,
        uint128 price,
        uint16 discountBps
    )
        public
        view
    {
        _guard();
        vm.assume(capitalization > 0 && discountBps < 10_000);
        uint256 got = harness.exposed_conversionPrice(cap, capitalization, price, discountBps);
        uint256 capPrice = uint256(cap) / capitalization;
        uint256 discounted = uint256(price) * (10_000 - discountBps) / 10_000;
        assert(got <= capPrice && got <= discounted);
        assert(got == capPrice || got == discounted);
    }

    /// @dev E4 (Rounds' side): the anti-diluted price never rises above CP1, and equals CP1 when the round price is
    /// not below CP1 or nothing was issued. The exact formula `CP1 * (A + B) / (A + C)` is the fuzz test's and the
    /// unit vectors' (`testFuzz_Close_AntiDilution`, the guard's 2,490,599): Halmos cannot decide a symbolic 256-bit
    /// division within the gate. J55 removes the redundant upper clamp with a mathematical proof; this unchanged
    /// assertion still requires the bound and the no-change branches over fv/halmos.md's `uint64` range. The full
    /// symbolic run remains follow-up work under J51.
    function check_E4_antiDilution(uint64 cp1, uint64 price, uint64 a, uint64 c) public view {
        _guard();
        vm.assume(cp1 > 0);
        uint128 cp2 = harness.exposed_antiDilutedPrice(cp1, price, a, c);
        assert(cp2 <= cp1);
        if (price >= cp1 || c == 0) assert(cp2 == cp1);
    }
}
