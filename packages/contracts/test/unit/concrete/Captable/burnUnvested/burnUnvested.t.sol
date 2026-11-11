// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICaptable } from "../../../../../src/interfaces/ICaptable.sol";
import { Captable_Test } from "../../../../utils/Captable/Captable_Test.sol";

contract BurnUnvested_Captable_Unit_Concrete_Test is Captable_Test {
    function test_WhenTheCallerIsNotTheAuthorizedModule() external {
        // it should revert with OnlyModule
        vm.expectRevert(ICaptable.OnlyModule.selector);
        captable.burnUnvested(COMMON, users.ben, 1);
    }
}
