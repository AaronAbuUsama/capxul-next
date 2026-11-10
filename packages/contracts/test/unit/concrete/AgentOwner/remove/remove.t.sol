// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { AgentOwner } from "../../../../../src/agents/AgentOwner.sol";
import { AgentOwner_Test } from "../../../../utils/AgentOwner/AgentOwner_Test.sol";

contract Remove_AgentOwner_Unit_Concrete_Test is AgentOwner_Test {
    address internal agentSafe;

    function setUp() public override {
        super.setUp();
        agentSafe = _create();
        usdc.mint(agentSafe, 100 * USDC_UNIT);
        dai.mint(agentSafe, 5 ether);
    }

    function _tokens() internal view returns (address[] memory tokens) {
        tokens = new address[](2);
        tokens[0] = address(usdc);
        tokens[1] = address(dai);
    }

    function test_WhenTheCallerIsNotTheAgentsOwner() external {
        // it should revert with NotOwner
        vm.prank(users.eve);
        vm.expectRevert(abi.encodeWithSelector(AgentOwner.NotOwner.selector, users.eve));
        agentOwner.remove(agentSafe, _tokens());
    }

    function test_GivenTheAgentWasAlreadyRemoved() external {
        // it should revert with AgentIsRemoved
        _remove(agentSafe);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(AgentOwner.AgentIsRemoved.selector, agentSafe));
        agentOwner.remove(agentSafe, _tokens());
    }

    function test_GivenTheAgentIsActive() external {
        // it should emit AgentRemoved
        uint256 usdcBefore = usdc.balanceOf(owner);
        uint256 daiBefore = dai.balanceOf(owner);
        vm.expectEmit(address(agentOwner));
        emit AgentOwner.AgentRemoved(agentSafe);
        vm.prank(owner);
        agentOwner.remove(agentSafe, _tokens());

        // it should sweep each token to the owner
        assertEq(usdc.balanceOf(owner) - usdcBefore, 100 * USDC_UNIT);
        assertEq(dai.balanceOf(owner) - daiBefore, 5 ether);
        assertEq(usdc.balanceOf(agentSafe), 0);
        assertEq(dai.balanceOf(agentSafe), 0);

        // it should swap the agent's key out for AgentOwner
        assertEq(_safeOwner(agentSafe), address(agentOwner));

        // it should mark the agent removed
        assertTrue(agentOwner.agentOf(agentSafe).removed);
    }

    function test_GivenTheAgentIsFrozen() external {
        _freeze(agentSafe);
        vm.prank(owner);
        agentOwner.remove(agentSafe, new address[](0));

        // it should leave AgentOwner as the Safe's owner
        assertEq(_safeOwner(agentSafe), address(agentOwner));

        // it should mark the agent removed
        assertTrue(agentOwner.agentOf(agentSafe).removed);
        assertEq(usdc.balanceOf(agentSafe), 100 * USDC_UNIT);
    }
}
