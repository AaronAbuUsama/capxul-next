// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { AgentOwner } from "../../../../../src/agents/AgentOwner.sol";
import { AgentOwner_Test } from "../../../../utils/AgentOwner/AgentOwner_Test.sol";

contract Constructor_AgentOwner_Unit_Concrete_Test is AgentOwner_Test {
    function test_WhenThePaymentsAddressIsZero() external {
        // it should revert with ZeroPayments
        vm.expectRevert(AgentOwner.ZeroPayments.selector);
        new AgentOwner(address(0));
    }

    function test_WhenThePaymentsAddressIsSet() external view {
        // it should keep it as PAYMENTS
        assertEq(address(agentOwner.PAYMENTS()), address(payments));
        assertEq(agentOwner.SWEEP_KIND(), 9);
    }
}
