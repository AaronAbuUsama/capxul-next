// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { AgentOwner } from "../../../../../src/agents/AgentOwner.sol";
import { AgentOwner_Test } from "../../../../utils/AgentOwner/AgentOwner_Test.sol";

contract Unfreeze_AgentOwner_Unit_Concrete_Test is AgentOwner_Test {
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
        agentOwner.unfreeze(stranger);
    }

    function test_WhenTheCallerIsNotTheAgentsOwner() external {
        // it should revert with NotOwner
        _freeze(agentSafe);
        vm.prank(users.eve);
        vm.expectRevert(abi.encodeWithSelector(AgentOwner.NotOwner.selector, users.eve));
        agentOwner.unfreeze(agentSafe);
    }

    function test_GivenTheAgentIsNotFrozen() external {
        // it should revert with NotFrozen
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(AgentOwner.NotFrozen.selector, agentSafe));
        agentOwner.unfreeze(agentSafe);
    }

    function test_WhenTheOwnerUnfreezesAFrozenAgent() external {
        _freeze(agentSafe);
        // it should emit AgentUnfrozen
        vm.expectEmit(address(agentOwner));
        emit AgentOwner.AgentUnfrozen(agentSafe);
        vm.prank(owner);
        agentOwner.unfreeze(agentSafe);

        // it should swap AgentOwner out for the agent's key on the Safe
        assertEq(_safeOwner(agentSafe), signer);

        // it should mark the agent not frozen
        assertFalse(agentOwner.agentOf(agentSafe).frozen);
    }
}
