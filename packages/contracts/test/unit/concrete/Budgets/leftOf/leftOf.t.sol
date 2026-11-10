// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Budgets_Shared_Test } from "../../../../utils/Budgets/Budgets_Shared_Test.sol";

contract LeftOf_Budgets_Unit_Concrete_Test is Budgets_Shared_Test {
    function test_WhenTheBudgetDoesNotExist() external view {
        // it should return zero
        assertEq(budgets.leftOf(type(uint256).max), 0, "unknown budget has no balance");
    }
}
