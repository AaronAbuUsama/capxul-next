// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICalendar } from "../../src/interfaces/ICalendar.sol";
import { CalendarHarness } from "../utils/Calendar/CalendarHarness.sol";

/// @notice Halmos checks for the Calendar (fv/halmos.md, gate 10): the linear layer only. The month clock's
/// date maths is proved by the exhaustive loops in test/exhaustive/Calendar.exhaustive.t.sol (R4 3.1).
/// @dev Vacuity guard (verification-loop.md): every library call goes through the harness inside
/// `try ... catch { assert(false); }`, and each check first proves one concrete call succeeds with the right
/// value, so a reverting stub is a counterexample, never a vacuous pass.
contract Calendar_Symbolic {
    uint8 internal constant WEEK = ICalendar.WEEK;
    uint8 internal constant MONTH = ICalendar.MONTH;
    uint8 internal constant YEAR = ICalendar.YEAR;
    uint256 internal constant SCALE = ICalendar.SCALE;
    uint256 internal constant DAY = ICalendar.DAY;

    CalendarHarness internal calendar;

    function setUp() public {
        calendar = new CalendarHarness();
    }

    /// @notice C1 algebra: for clock readings `ca <= cb <= cc` and the period's numerator `n`,
    /// `n*(cc-ca) == n*(cb-ca) + n*(cc-cb)`, with no overflow for a `uint128` rate and `uint96` clocks (a clock
    /// to 9999 is below 2**53 on the month clock and 2**84 on the week clock).
    function check_C1_earnedAlgebra(uint128 rate, uint8 period, uint96 ca, uint96 cb, uint96 cc) public view {
        _guard();
        if (period > YEAR || ca > cb || cb > cc) return;
        uint256 n;
        try calendar.numerator(rate, period) returns (uint256 value) {
            n = value;
        } catch {
            assert(false);
        }
        assert(n == (period == MONTH ? uint256(rate) * 12 : uint256(rate)));
        assert(n * (uint256(cc) - ca) == n * (uint256(cb) - ca) + n * (uint256(cc) - cb));
    }

    /// @notice C1 and C2 in full for WEEK: `earned(a, c) == earned(a, b) + earned(b, c)` and
    /// `earned(a, b) <= earned(a, c)` for `a <= b <= c`, and it equals `rate * (b - a) * WEEK_UNITS_PER_SECOND`.
    /// @dev Bounded inputs (decisions.md J13): a `uint32` rate and `uint40` times (to the year 36,812). The full
    /// range (`uint128` rate, every time to 2200, every period) is left to the fuzz tests
    /// `testFuzz_Earned_C1_SplittingLosesNothing` and `testFuzz_Earned_C2_NeverDecreases`
    /// (test/unit/fuzz/Calendar/earned.t.sol) and `invariant_C7_collectedIsExactAndRoundsDown`.
    /// KNOWN NOT TO FINISH in Halmos 0.3.3 within 600 s at any width tried (`uint128`/`uint64`, `uint32`/`uint40`,
    /// `uint16`/`uint32`, `uint8`/`uint8`). The blocker is not the input width: every checked multiplication in
    /// `earned` (`t * WEEK_UNITS_PER_SECOND`, `rate * clock difference`) carries Solidity's overflow guard
    /// `x == 0 || (x * y) / x == y`, a 256-bit division by a symbolic value. Halmos abstracts it, finds a spurious
    /// overflow path and refines it to an exact `bvudiv`, which yices, z3 and bitwuzla 0.8.1 do not decide for a
    /// divisor of 16 or more symbolic bits (Halmos's `div_xy_y` rewrite is a TODO in 0.3.3, bitvec.py:548).
    function check_C1_C2_week(uint32 rate, uint40 a, uint40 b, uint40 c) public view {
        _guard();
        if (a > b || b > c) return;
        uint256 ab = _earned(rate, WEEK, a, b);
        uint256 bc = _earned(rate, WEEK, b, c);
        uint256 ac = _earned(rate, WEEK, a, c);
        assert(ac == ab + bc);
        assert(ab <= ac);
        assert(ab == uint256(rate) * (uint256(b) - a) * ICalendar.WEEK_UNITS_PER_SECOND);
    }

    /// @notice C5 for WEEK: over the longest month (31 days), quarter (92 days) and year (366 days), a weekly
    /// rate earns at most the period figure.
    /// @dev Bounded inputs (decisions.md J13): a `uint32` rate and a `uint40` time. The full range (`uint128`
    /// rate, every budget period to 2200, every rate period) is left to the fuzz test
    /// `testFuzz_PeriodFigure_C5_NeverLessThanOnePeriodEarns` (test/unit/fuzz/Calendar/periodFigure.t.sol),
    /// and the MONTH and YEAR rows to `testExhaustive_C5_monthYear`. KNOWN NOT TO FINISH in Halmos 0.3.3 within
    /// 600 s (`uint128`/`uint64` and `uint32`/`uint40` tried), for the overflow-guard division described on
    /// `check_C1_C2_week`.
    function check_C5_week(uint32 rate, uint40 t) public view {
        _guard();
        uint256[3] memory lengths = [31 * DAY, 92 * DAY, 366 * DAY];
        for (uint8 bp; bp < 3; ++bp) {
            uint256 figure;
            try calendar.periodFigure(rate, WEEK, bp) returns (uint256 value) {
                figure = value;
            } catch {
                assert(false);
            }
            assert(_earned(rate, WEEK, t, uint256(t) + lengths[bp]) <= figure * SCALE);
        }
    }

    /// @dev One concrete call must succeed with the right value: on the stub it reverts, which is a
    /// counterexample.
    function _guard() internal view {
        assert(_earned(1, WEEK, 0, 7 * DAY) == SCALE);
    }

    function _earned(uint256 rate, uint8 period, uint256 from, uint256 to) internal view returns (uint256 value) {
        try calendar.earned(rate, period, from, to) returns (uint256 v) {
            value = v;
        } catch {
            assert(false);
        }
    }
}
