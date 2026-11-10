// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { AgentOwner } from "../../../../../src/agents/AgentOwner.sol";
import { AgentOwner_Test } from "../../../../utils/AgentOwner/AgentOwner_Test.sol";

contract CheckModuleTransaction_AgentOwner_Unit_Concrete_Test is AgentOwner_Test {
    address internal agentSafe;

    function setUp() public override {
        super.setUp();
        agentSafe = _create();
    }

    function _check(address to, uint8 operation, address module) internal returns (bytes32) {
        vm.prank(agentSafe);
        return agentOwner.checkModuleTransaction(to, 0, "", operation, module);
    }

    function test_WhenAgentOwnerIsTheModule() external {
        // it should pass a call to the agent's own Safe
        assertEq(_check(agentSafe, 0, address(agentOwner)), bytes32(0));
    }

    function test_WhenTheModuleCallHasRun() external view {
        // it should check nothing after it
        agentOwner.checkAfterModuleExecution(bytes32(0), true);
    }

    modifier whenAnotherModuleCalls() {
        _;
    }

    function test_GivenTheAgentIsFrozen() external whenAnotherModuleCalls {
        // it should revert with AgentInactive
        _freeze(agentSafe);
        vm.expectRevert(abi.encodeWithSelector(AgentOwner.AgentInactive.selector, agentSafe));
        _check(users.bob, 0, SAFE_4337_MODULE);
    }

    function test_GivenTheAgentIsRemoved() external whenAnotherModuleCalls {
        // it should revert with AgentInactive
        _remove(agentSafe);
        vm.expectRevert(abi.encodeWithSelector(AgentOwner.AgentInactive.selector, agentSafe));
        _check(users.bob, 0, SAFE_4337_MODULE);
    }

    function test_WhenItCallsTheAgentsOwnSafe() external whenAnotherModuleCalls {
        // it should revert with AgentSelfCall
        vm.expectRevert(abi.encodeWithSelector(AgentOwner.AgentSelfCall.selector, agentSafe, agentSafe, uint8(0)));
        _check(agentSafe, 0, SAFE_4337_MODULE);
    }

    function test_WhenItDelegatecalls() external whenAnotherModuleCalls {
        // it should revert with AgentSelfCall
        vm.expectRevert(abi.encodeWithSelector(AgentOwner.AgentSelfCall.selector, agentSafe, users.bob, uint8(1)));
        _check(users.bob, 1, SAFE_4337_MODULE);
    }

    function test_WhenItCallsAnotherAddress() external whenAnotherModuleCalls {
        // it should pass
        assertEq(_check(users.bob, 0, SAFE_4337_MODULE), bytes32(0));
    }
}
