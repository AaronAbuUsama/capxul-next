// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IOptions } from "../../../../../src/interfaces/IOptions.sol";
import { Options_Shared_Test } from "../../../../utils/Options/Options_Shared_Test.sol";

contract Initialize_Options_Unit_Concrete_Test is Options_Shared_Test {
    function test_WhenTheImplementationOrCloneIsAlreadyInitialized() external {
        // it should reject a second initialization
        vm.expectRevert(IOptions.AlreadyInitialized.selector);
        implementation.initialize(address(safe), address(captable), address(payments), COMMON);
        vm.expectRevert(IOptions.AlreadyInitialized.selector);
        options.initialize(address(safe), address(captable), address(payments), COMMON);
    }
}
