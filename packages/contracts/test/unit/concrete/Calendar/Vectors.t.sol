// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Calendar_Shared_Test } from "../../../utils/Calendar/Calendar_Shared_Test.sol";

/// @notice C8: the shared vector files pass unchanged. `payroll-calendar.json` is beta's file byte for byte
/// (R2 CL1; replay ported from beta `packages/contracts/test/unit/PayrollCalendar.t.sol:31-61`), and
/// `calendar-v4.json` adds periodIndex, periodFigure and monthsBetween. Both live under `scenarios/vectors/`
/// because foundry.toml lets tests read only `./scenarios`.
contract Vectors_Calendar_Unit_Concrete_Test is Calendar_Shared_Test {
    string internal payroll;
    string internal v4;

    function setUp() public override {
        super.setUp();
        payroll = vm.readFile(string.concat(vm.projectRoot(), "/scenarios/vectors/payroll-calendar.json"));
        v4 = vm.readFile(string.concat(vm.projectRoot(), "/scenarios/vectors/calendar-v4.json"));
    }

    function test_C8_EveryPayVectorPaysItsExactCalendarAmount() external view {
        uint256 n = _length(payroll, ".pay");
        assertGt(n, 40, "the vectors");
        for (uint256 i; i < n; ++i) {
            string memory at = string.concat(".pay[", vm.toString(i), "]");
            uint256 rate = vm.parseUint(vm.parseJsonString(payroll, string.concat(at, ".rate")));
            uint8 period = _ratePeriod(vm.parseJsonString(payroll, string.concat(at, ".period")));
            uint256 from = vm.parseJsonUint(payroll, string.concat(at, ".from"));
            uint256 to = vm.parseJsonUint(payroll, string.concat(at, ".to"));
            uint256 pay = vm.parseUint(vm.parseJsonString(payroll, string.concat(at, ".pay")));
            string memory name = vm.parseJsonString(payroll, string.concat(at, ".name"));
            assertEq(calendar.earned(rate, period, from, to) / SCALE, pay, name);
        }
    }

    function test_C8_EveryDateVectorNamesItsMonth() external view {
        uint256 n = _length(payroll, ".dates");
        assertGt(n, 0, "the vectors");
        for (uint256 i; i < n; ++i) {
            string memory at = string.concat(".dates[", vm.toString(i), "]");
            uint256 t = vm.parseJsonUint(payroll, string.concat(at, ".at"));
            string memory iso = vm.parseJsonString(payroll, string.concat(at, ".iso"));
            (uint256 year, uint256 month, uint256 day) = calendar.dateOf(t / DAY);
            assertEq(year, vm.parseJsonUint(payroll, string.concat(at, ".year")), iso);
            assertEq(month, vm.parseJsonUint(payroll, string.concat(at, ".month")), iso);
            assertEq(day, vm.parseJsonUint(payroll, string.concat(at, ".day")), iso);
            (, uint256 start, uint256 length) = calendar.monthOf(t);
            assertEq(start, vm.parseJsonUint(payroll, string.concat(at, ".monthStart")), iso);
            assertEq(length / DAY, vm.parseJsonUint(payroll, string.concat(at, ".daysInMonth")), iso);
            assertEq(calendar.monthStart(t), start, iso);
            assertEq(calendar.nextMonthStart(t), start + length, iso);
        }
    }

    function test_C8_EveryPeriodIndexVector() external view {
        uint256 n = _length(v4, ".periodIndex");
        assertGt(n, 0, "the vectors");
        for (uint256 i; i < n; ++i) {
            string memory at = string.concat(".periodIndex[", vm.toString(i), "]");
            uint8 p = _budgetPeriod(vm.parseJsonString(v4, string.concat(at, ".period")));
            uint256 t = vm.parseJsonUint(v4, string.concat(at, ".at"));
            string memory name = vm.parseJsonString(v4, string.concat(at, ".name"));
            assertEq(calendar.periodIndex(p, t), vm.parseJsonUint(v4, string.concat(at, ".index")), name);
            assertEq(calendar.periodStart(p, t), vm.parseJsonUint(v4, string.concat(at, ".start")), name);
            assertEq(calendar.nextPeriodStart(p, t), vm.parseJsonUint(v4, string.concat(at, ".nextStart")), name);
        }
    }

    function test_C8_EveryPeriodFigureVector() external view {
        uint256 n = _length(v4, ".periodFigure");
        assertGt(n, 0, "the vectors");
        for (uint256 i; i < n; ++i) {
            string memory at = string.concat(".periodFigure[", vm.toString(i), "]");
            uint256 rate = vm.parseUint(vm.parseJsonString(v4, string.concat(at, ".rate")));
            uint8 rp = _ratePeriod(vm.parseJsonString(v4, string.concat(at, ".ratePeriod")));
            uint8 bp = _budgetPeriod(vm.parseJsonString(v4, string.concat(at, ".budgetPeriod")));
            uint256 figure = vm.parseUint(vm.parseJsonString(v4, string.concat(at, ".figure")));
            assertEq(calendar.periodFigure(rate, rp, bp), figure, at);
        }
    }

    function test_C8_EveryMonthsBetweenVector() external view {
        uint256 n = _length(v4, ".monthsBetween");
        assertGt(n, 0, "the vectors");
        for (uint256 i; i < n; ++i) {
            string memory at = string.concat(".monthsBetween[", vm.toString(i), "]");
            uint256 from = vm.parseJsonUint(v4, string.concat(at, ".start"));
            uint256 to = vm.parseJsonUint(v4, string.concat(at, ".to"));
            string memory name = vm.parseJsonString(v4, string.concat(at, ".name"));
            assertEq(calendar.monthsBetween(from, to), vm.parseJsonUint(v4, string.concat(at, ".months")), name);
        }
    }

    function _length(string memory json, string memory key) internal view returns (uint256 n) {
        while (vm.keyExistsJson(json, string.concat(key, "[", vm.toString(n), "]"))) ++n;
    }

    function _ratePeriod(string memory text) internal pure returns (uint8) {
        bytes32 h = keccak256(bytes(text));
        if (h == keccak256("week")) return WEEK;
        if (h == keccak256("month")) return MONTH;
        if (h == keccak256("year")) return YEAR;
        revert UnknownVectorPeriod(text);
    }

    function _budgetPeriod(string memory text) internal pure returns (uint8) {
        bytes32 h = keccak256(bytes(text));
        if (h == keccak256("month")) return BUDGET_MONTH;
        if (h == keccak256("quarter")) return BUDGET_QUARTER;
        if (h == keccak256("year")) return BUDGET_YEAR;
        revert UnknownVectorPeriod(text);
    }

    error UnknownVectorPeriod(string text);
}
