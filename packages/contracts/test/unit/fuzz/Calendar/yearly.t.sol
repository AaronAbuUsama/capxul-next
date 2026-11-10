// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Calendar_Shared_Test } from "../../../utils/Calendar/Calendar_Shared_Test.sol";

contract Yearly_Calendar_Unit_Fuzz_Test is Calendar_Shared_Test {
    function testFuzz_Yearly(uint256 rate) external view {
        rate = bound(rate, 0, type(uint256).max / 53);
        assertEq(calendar.yearly(rate, WEEK), rate * 53, "WEEK");
        assertEq(calendar.yearly(rate, MONTH), rate * 12, "MONTH");
        assertEq(calendar.yearly(rate, YEAR), rate, "YEAR");
    }

    function testFuzz_Yearly_RevertWhen_UnknownPeriod(uint256 rate, uint8 period) external {
        period = uint8(bound(period, YEAR + 1, type(uint8).max));
        _expectInvalidPeriod(period);
        calendar.yearly(rate, period);
    }
}
