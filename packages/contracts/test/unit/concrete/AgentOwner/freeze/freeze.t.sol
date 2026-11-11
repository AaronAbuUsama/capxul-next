// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { AgentOwner } from "../../../../../src/agents/AgentOwner.sol";
import { MockAgentSafe } from "../../../../utils/AgentOwner/AgentMocks.sol";
import { AgentOwner_Test } from "../../../../utils/AgentOwner/AgentOwner_Test.sol";

contract Freeze_AgentOwner_Unit_Concrete_Test is AgentOwner_Test {
    address internal agentSafe;

    function setUp() public override {
        super.setUp();
        agentSafe = _create();
    }

    function test_GivenNoAgentHasTheSafe() external {
        // it should revert with UnknownAgent
        address stranger = makeAddr("stranger");
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(AgentOwner.UnknownAgent.selector, stranger));
        agentOwner.freeze(stranger);
    }

    function test_WhenTheCallerIsNotTheAgentsOwner() external {
        // it should revert with NotOwner
        vm.prank(users.eve);
        vm.expectRevert(abi.encodeWithSelector(AgentOwner.NotOwner.selector, users.eve));
        agentOwner.freeze(agentSafe);
        // The agent's own key is not its owner either.
        vm.prank(signer);
        vm.expectRevert(abi.encodeWithSelector(AgentOwner.NotOwner.selector, signer));
        agentOwner.freeze(agentSafe);
    }

    function test_GivenTheAgentWasRemoved() external {
        // it should revert with AgentIsRemoved
        _remove(agentSafe);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(AgentOwner.AgentIsRemoved.selector, agentSafe));
        agentOwner.freeze(agentSafe);
    }

    function test_GivenTheAgentIsAlreadyFrozen() external {
        // it should revert with AlreadyFrozen
        _freeze(agentSafe);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(AgentOwner.AlreadyFrozen.selector, agentSafe));
        agentOwner.freeze(agentSafe);
    }

    function test_WhenTheSafeRefusesTheModuleCall() external {
        // it should revert with ModuleCallFailed
        MockAgentSafe(agentSafe).setRefusesModuleCalls(true);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(AgentOwner.ModuleCallFailed.selector, agentSafe));
        agentOwner.freeze(agentSafe);
    }

    function test_WhenTheOwnerFreezesAnActiveAgent() external {
        // it should emit AgentFrozen
        vm.expectEmit(address(agentOwner));
        emit AgentOwner.AgentFrozen(agentSafe);
        _freeze(agentSafe);

        // it should swap the agent's key out for AgentOwner on the Safe
        assertEq(_safeOwner(agentSafe), address(agentOwner));

        // it should keep the key and mark the agent frozen
        AgentOwner.Agent memory agent = agentOwner.agentOf(agentSafe);
        assertEq(agent.signer, signer);
        assertTrue(agent.frozen);
    }
}
