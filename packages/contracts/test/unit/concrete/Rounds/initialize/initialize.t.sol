// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IRounds } from "../../../../../src/interfaces/IRounds.sol";
import { Rounds_Shared_Test } from "../../../../utils/Rounds/Rounds_Shared_Test.sol";

contract Initialize_Rounds_Unit_Concrete_Test is Rounds_Shared_Test {
    function test_WhenTheImplementationOrCloneIsAlreadyInitialized() external {
        // it should reject a second initialization
        vm.expectRevert(IRounds.AlreadyInitialized.selector);
        implementation.initialize(address(safe), address(captable), address(payments));
        vm.expectRevert(IRounds.AlreadyInitialized.selector);
        rounds.initialize(address(safe), address(captable), address(payments));
    }
}
