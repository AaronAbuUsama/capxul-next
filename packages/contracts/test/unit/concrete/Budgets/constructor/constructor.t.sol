// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Budgets } from "../../../../../src/money/Budgets.sol";
import { IBudgets } from "../../../../../src/interfaces/IBudgets.sol";
import { Budgets_Shared_Test } from "../../../../utils/Budgets/Budgets_Shared_Test.sol";

contract Constructor_Budgets_Unit_Concrete_Test is Budgets_Shared_Test {
    function test_WhenADependencyIsZero() external {
        // it should reject an unusable deployment
        vm.expectRevert(IBudgets.ZeroAddress.selector);
        new Budgets(address(0), address(hats));
        vm.expectRevert(IBudgets.ZeroAddress.selector);
        new Budgets(address(payments), address(0));
    }
}
