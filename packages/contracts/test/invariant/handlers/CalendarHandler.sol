// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { console2 } from "forge-std/console2.sol";
import { CommonBase } from "forge-std/Base.sol";
import { StdUtils } from "forge-std/StdUtils.sol";

import { ICalendar } from "../../../src/interfaces/ICalendar.sol";
import { CalendarHarness } from "../../utils/Calendar/CalendarHarness.sol";

/// @notice Drives the Calendar the way Agreements will: three payees each on one rate period, paid out in
/// segments whenever they collect, while time moves in uneven steps; and eve, who probes every function with
/// rate and budget periods that do not exist. Every input is bounded, so nothing here reverts on a correct
/// library (`fail_on_revert = true`); against the stub the first library call reverts `NotImplemented()`.
contract CalendarHandler is CommonBase, StdUtils {
    struct Stream {
        address payee;
        uint8 period;
        uint256 rate;
        uint256 startsAt;
        uint256 lastCollected;
        uint256 scaledCollected; // sum of the segments' `earned`, scaled
        uint256 unitsCollected; // what the payee was paid, in token units
    }

    CalendarHarness public immutable calendar;
    address public immutable eve;
    Stream[3] internal streams;
    uint256 public now_;
    /// @dev Set when an unknown period is accepted or refused with the wrong error.
    bool public unknownPeriodAccepted;

    mapping(bytes32 action => uint256 count) public calls;

    constructor(CalendarHarness calendar_, address alice, address bob, address jordan, address eve_, uint256 start) {
        calendar = calendar_;
        eve = eve_;
        now_ = start;
        streams[0] = Stream(alice, ICalendar.YEAR, 40_000e6, start, start, 0, 0);
        streams[1] = Stream(bob, ICalendar.MONTH, 3000e6 + 7, start, start, 0, 0);
        streams[2] = Stream(jordan, ICalendar.WEEK, 250e6 + 1, start, start, 0, 0);
    }

    /// @notice Time moves forward by a second to 20 days.
    function warp(uint256 dt) external {
        dt = _bound(dt, 1, 20 days);
        now_ += dt;
        vm.warp(now_);
        ++calls["warp"];
    }

    /// @notice A payee collects what they earned since their last collection.
    function collect(uint256 payeeSeed) external {
        Stream storage s = streams[payeeSeed % 3];
        vm.prank(s.payee);
        s.scaledCollected += calendar.earned(s.rate, s.period, s.lastCollected, now_);
        s.lastCollected = now_;
        s.unitsCollected = s.scaledCollected / ICalendar.SCALE;
        ++calls["collect"];
    }

    /// @notice Eve calls with a rate or budget period above the known ones; each must revert with the
    /// matching error.
    function eveUnknownPeriod(uint8 period, uint256 which) external {
        period = uint8(_bound(period, ICalendar.YEAR + 1, type(uint8).max));
        which = which % 4;
        bytes4 want = which == 3 ? ICalendar.InvalidBudgetPeriod.selector : ICalendar.InvalidPeriod.selector;
        vm.prank(eve);
        try this.probe(period, which) {
            unknownPeriodAccepted = true;
        } catch (bytes memory reason) {
            if (keccak256(reason) != keccak256(abi.encodeWithSelector(want, period))) unknownPeriodAccepted = true;
        }
        ++calls["eveUnknownPeriod"];
    }

    /// @dev External so `eveUnknownPeriod` can catch its revert.
    function probe(uint8 period, uint256 which) external view {
        if (which == 0) calendar.earned(1, period, now_, now_ + 1);
        else if (which == 1) calendar.clock(period, now_);
        else if (which == 2) calendar.periodFigure(1, period, ICalendar.BUDGET_MONTH);
        else calendar.periodIndex(period, now_);
    }

    function stream(uint256 i) external view returns (Stream memory) {
        return streams[i];
    }

    function callSummary() external view {
        console2.log("CalendarHandler calls");
        console2.log("  warp", calls["warp"]);
        console2.log("  collect", calls["collect"]);
        console2.log("  eveUnknownPeriod", calls["eveUnknownPeriod"]);
    }
}
