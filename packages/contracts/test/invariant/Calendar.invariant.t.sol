// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICalendar } from "../../src/interfaces/ICalendar.sol";
import { Calendar_Shared_Test } from "../utils/Calendar/Calendar_Shared_Test.sol";
import { CalendarModel } from "../utils/Calendar/CalendarModel.sol";
import { CalendarHandler } from "./handlers/CalendarHandler.sol";

/// @notice C7 (and C1 along the way) over handler-driven collections: whatever the payees' collection times,
/// the scaled pay summed over segments equals the model's exact pay for the whole span, and what was paid in
/// token units is never over it and short by under one unit. Eve's unknown periods always revert.
contract Calendar_Invariant_Test is Calendar_Shared_Test {
    CalendarHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new CalendarHandler(calendar, users.alice, users.bob, users.jordan, users.eve, block.timestamp);
        vm.label(address(handler), "CalendarHandler");
        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = CalendarHandler.warp.selector;
        selectors[1] = CalendarHandler.collect.selector;
        selectors[2] = CalendarHandler.eveUnknownPeriod.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
        targetContract(address(handler));
    }

    /// @dev C7 and C1: segments sum to the exact span, and units paid are under it by less than one.
    function invariant_C7_collectedIsExactAndRoundsDown() external view {
        for (uint256 i; i < 3; ++i) {
            CalendarHandler.Stream memory s = handler.stream(i);
            uint256 exact = CalendarModel.pay(s.rate, s.period, s.startsAt, s.lastCollected);
            assertEq(s.scaledCollected, exact, "segments sum to the whole span (C1)");
            assertLe(s.unitsCollected * ICalendar.SCALE, exact, "never over (C7)");
            assertLt(exact - s.unitsCollected * ICalendar.SCALE, ICalendar.SCALE, "short by under one unit (C7)");
        }
    }

    /// @dev Nothing paid is more than was earned up to now.
    function invariant_C7_neverPaysAheadOfTime() external view {
        for (uint256 i; i < 3; ++i) {
            CalendarHandler.Stream memory s = handler.stream(i);
            assertLe(
                s.unitsCollected * ICalendar.SCALE, CalendarModel.pay(s.rate, s.period, s.startsAt, handler.now_())
            );
        }
    }

    /// @dev Eve's periods above YEAR or BUDGET_YEAR always revert with the matching error.
    function invariant_UnknownPeriodsAlwaysRevert() external view {
        assertFalse(handler.unknownPeriodAccepted(), "an unknown period was accepted");
    }

    function afterInvariant() external view {
        handler.callSummary();
    }
}
