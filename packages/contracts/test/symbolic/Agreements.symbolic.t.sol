// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";

import { Agreements } from "../../src/money/Agreements.sol";
import { MockERC20 } from "../mocks/MockERC20.sol";
import { MockHats } from "../mocks/MockHats.sol";
import { MockRoles } from "../mocks/MockRoles.sol";
import { MockSafe } from "../mocks/MockSafe.sol";
import { MockBudgets } from "../utils/Agreements/MockBudgets.sol";

/// @notice Halmos checks for Agreements (fv/halmos.md, gate 10): A3 and A9. Each check first proves one
/// concrete call succeeds (`try ... catch { assert(false); }`), so a reverting stub is a counterexample
/// and never a vacuous pass (verification-loop.md, vacuity). Times are symbolic offsets from a concrete
/// start, with a concrete rate in A3 and concrete term lengths in A9 so every product stays linear; rates
/// accrue by the WEEK clock (`t * WEEK_UNITS_PER_SECOND`) with a one-second step, the case Halmos can
/// prove without the month clock's date division (R4 section 2). MONTH and YEAR are the
/// fuzz and invariant suites' (A3, A9 rows).
contract Agreements_Symbolic is Test {
    uint256 internal constant START = 1_767_225_600; // 2026-01-01T00:00:00Z
    uint256 internal constant OPS_HAT = 7;
    bytes32 internal constant KEY = "capxul.payout";
    bytes32 internal constant TERMS = keccak256("terms");
    uint256 internal constant SCALE = 12 * 377_580 * 86_400;
    uint256 internal constant WEEK_UNITS_PER_SECOND = SCALE / 604_800;
    uint8 internal constant WEEK = 0;
    /// @dev A3's rate: concrete, odd, so the accrual products stay linear in the symbolic times.
    uint128 internal constant RATE = 1_151_000_007;

    Agreements internal agreements;
    MockBudgets internal budgets;
    MockERC20 internal usdc;
    address internal jordan = address(0x10a);
    address internal alice = address(0xa11ce);
    uint256 internal yearly; // a BUDGET_YEAR budget
    uint256 internal monthly; // a BUDGET_MONTH budget
    uint256 internal quarterly; // a BUDGET_QUARTER budget

    function setUp() public {
        vm.warp(START);
        MockHats hats = new MockHats();
        MockSafe safe = new MockSafe(address(this));
        MockRoles roles = new MockRoles(safe);
        safe.enableModule(address(roles));
        usdc = new MockERC20("USD Coin", "USDC", 6);
        usdc.mint(address(safe), 1e30);
        budgets = new MockBudgets(hats);
        agreements = new Agreements(address(budgets));
        budgets.setAgreements(address(agreements));
        roles.setMember(KEY, address(budgets), true);
        roles.allowTarget(KEY, address(usdc), true);
        roles.setAllowance(KEY, address(usdc), type(uint256).max);
        hats.setWearer(OPS_HAT, jordan, true);
        uint128 big = type(uint128).max;
        yearly = budgets.create(address(safe), 0, OPS_HAT, address(usdc), 2, big, address(roles), KEY);
        monthly = budgets.create(address(safe), 0, OPS_HAT, address(usdc), 0, big, address(roles), KEY);
        quarterly = budgets.create(address(safe), 0, OPS_HAT, address(usdc), 1, big, address(roles), KEY);
    }

    // ------------------------------------------------------------------ A3

    /// @notice A3: no pay accrues for time after an agreement's end, for any end and any later time up to an
    /// hour each (J13).
    function check_A3_noAccrualAfterEnd(uint32 endDelay, uint32 extra) public {
        uint128 rate = RATE;
        // J13: bounded to an hour each. With a year each, and with 2^16 s each, the check did not finish
        // (600 s and 240 s under Halmos 0.3.3: earned pay's division by SCALE); 4,095 s each finished in 26 s.
        // Ends and reads up to a year are the fuzz test's (end.t.sol, testFuzz_NothingIsEarnedAfterTheEnd) and
        // the invariant suite's (A3).
        vm.assume(endDelay > 0 && endDelay <= 1 hours);
        vm.assume(extra <= 1 hours);
        uint256 id = _stream(rate); // vacuity guard: offer and accept must succeed
        uint64 endsAt = uint64(START + endDelay);
        vm.prank(jordan);
        try agreements.end(id, endsAt) { }
        catch {
            assert(false);
        }
        vm.warp(endsAt);
        uint128 atEnd = _earned(id);
        vm.warp(uint256(endsAt) + extra);
        assert(_earned(id) == atEnd);
        assert(atEnd == uint128(uint256(rate) * endDelay * WEEK_UNITS_PER_SECOND / SCALE));
    }

    /// @notice A3: no pay accrues while an agreement is paused, for any pause time and pause length up to an
    /// hour each (J13).
    function check_A3_noAccrualWhilePaused(uint32 runFor, uint32 pausedFor) public {
        uint128 rate = RATE;
        // J13: bounded to an hour each. With a year each the check did not finish in 600 s under Halmos 0.3.3
        // (earned pay's division by SCALE). Runs and pauses up to 200 days are the fuzz test's (pause.t.sol,
        // testFuzz_NothingIsEarnedWhilePaused) and the invariant suite's (A3).
        vm.assume(runFor <= 1 hours && pausedFor <= 1 hours);
        uint256 id = _stream(rate);
        vm.warp(START + runFor);
        vm.prank(jordan);
        try agreements.pause(id) { }
        catch {
            assert(false);
        }
        uint128 atPause = _earned(id);
        vm.warp(START + uint256(runFor) + pausedFor);
        assert(_earned(id) == atPause);
    }

    // ------------------------------------------------------------------ A9

    /// @notice A9: an open-ended reservation is exactly the period figure, never above it (spec/calendar.md
    /// table), for every rate whose figure fits 128 bits, over all nine period pairs. The pairs are written
    /// out concretely so each figure is a product or a division by a constant (linear for the solver).
    function check_A9_reservationNeverAboveFigure(uint128 rate) public view {
        _reservationWorks(); // vacuity guard
        vm.assume(rate > 0 && rate <= type(uint128).max / 53);
        _figureIs(rate, 0);
        _figureIs(rate, 1);
        _figureIs(rate, 2);
    }

    /// @dev The reservation of an open-ended agreement of `period` equals the figure in each budget period.
    function _figureIs(uint128 rate, uint8 period) internal view {
        assert(agreements.reservation(rate, period, 0, uint64(START), 0) == _figure(rate, period, 0));
        assert(agreements.reservation(rate, period, 1, uint64(START), 0) == _figure(rate, period, 1));
        assert(agreements.reservation(rate, period, 2, uint64(START), 0) == _figure(rate, period, 2));
    }

    /// @notice A9: a weekly fixed term of 31 days or of a leap year, at any rate to 2^8, reserves no more than
    /// the period figure and exactly the lesser of it and its pay, so its pay inside one budget period never
    /// exceeds its reservation. Lengths and budget periods are written out concretely.
    function check_A9_reservationCoversPay(uint128 rate) public view {
        _reservationWorks();
        // J13: bounded to 8 bits. At 64 and 32 bits the check did not finish in 600 s under Halmos 0.3.3, and
        // one of its six cases alone did not finish in 240 s at 16 bits (the term pay's division by SCALE);
        // rates above 2^8 up to 2^64 are the fuzz test's (reservation.t.sol,
        // testFuzz_WeeklyFixedTermToUint64CoversPay, same lengths and budget periods).
        vm.assume(rate > 0 && rate <= type(uint8).max);
        // Written out, not looped: Halmos counts every visit to a loop head against its bound (R4 2).
        _covers(rate, 31 days); // shorter than a month: the term's pay in every budget period
        _covers(rate, 366 days); // a leap year: the figure in a month or quarter budget, the pay in a year
    }

    /// @dev For each budget period: the reservation is within the figure and is min(figure, term pay rounded
    /// down). The floor is stated as `r * SCALE <= pay < (r + 1) * SCALE` so the solver sees only products by
    /// constants, never a symbolic division.
    function _covers(uint128 rate, uint64 length) internal view {
        uint256 scaledPay = uint256(rate) * (length * WEEK_UNITS_PER_SECOND);
        _coversIn(rate, length, scaledPay, 0);
        _coversIn(rate, length, scaledPay, 1);
        _coversIn(rate, length, scaledPay, 2);
    }

    function _coversIn(uint128 rate, uint64 length, uint256 scaledPay, uint8 budgetPeriod) internal view {
        uint256 r = agreements.reservation(rate, WEEK, budgetPeriod, uint64(START), uint64(START) + length);
        uint256 figure = _figure(rate, WEEK, budgetPeriod);
        assert(r <= figure);
        if (r < figure) {
            assert(r * SCALE <= scaledPay && scaledPay < (r + 1) * SCALE); // the term's pay, rounded down
        } else {
            assert(figure * SCALE <= scaledPay); // the term pays at least the figure
        }
    }

    // ------------------------------------------------------------------ helpers

    /// @dev Jordan offers Alice `rate` a week from the yearly budget, released every second; Alice accepts
    /// at the start. Both calls must succeed.
    function _stream(uint128 rate) internal returns (uint256 id) {
        vm.prank(jordan);
        try agreements.offer(yearly, alice, rate, WEEK, 0, 0, 1, uint64(START + 7 days), TERMS) returns (uint256 i) {
            id = i;
        } catch {
            assert(false);
        }
        vm.prank(alice);
        try agreements.accept(id, TERMS) { }
        catch {
            assert(false);
        }
    }

    function _earned(uint256 id) internal view returns (uint128 e) {
        try agreements.earnedOf(id) returns (uint128 v) {
            e = v;
        } catch {
            assert(false);
        }
    }

    function _reservationWorks() internal view {
        try agreements.reservation(1000e6, WEEK, 2, uint64(START), 0) returns (uint128 r) {
            assert(r == 53_000e6);
        } catch {
            assert(false);
        }
    }

    function _figure(uint256 rate, uint8 period, uint8 budgetPeriod) internal pure returns (uint128) {
        if (period == 0) return uint128(rate * (budgetPeriod == 0 ? 5 : budgetPeriod == 1 ? 14 : 53));
        if (period == 1) return uint128(rate * (budgetPeriod == 0 ? 1 : budgetPeriod == 1 ? 3 : 12));
        uint256 parts = budgetPeriod == 0 ? 12 : budgetPeriod == 1 ? 4 : 1;
        return uint128((rate + parts - 1) / parts);
    }
}
