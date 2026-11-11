// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { AgentOwner } from "../../../../src/agents/AgentOwner.sol";
import { AgentOwner_Test } from "../../../utils/AgentOwner/AgentOwner_Test.sol";

contract OwnerPowers_AgentOwner_Unit_Fuzz_Test is AgentOwner_Test {
    address internal agentSafe;

    function setUp() public override {
        super.setUp();
        agentSafe = _create();
    }

    function testFuzz_RevertWhen_TheCallerIsNotTheAgentsOwner(address caller, address key) external {
        vm.assume(caller != owner);
        bytes memory notOwner = abi.encodeWithSelector(AgentOwner.NotOwner.selector, caller);
        vm.startPrank(caller);
        vm.expectRevert(notOwner);
        agentOwner.freeze(agentSafe);
        vm.expectRevert(notOwner);
        agentOwner.unfreeze(agentSafe);
        vm.expectRevert(notOwner);
        agentOwner.swapSigner(agentSafe, signer, key);
        vm.expectRevert(notOwner);
        agentOwner.sweep(agentSafe, caller, address(usdc));
        vm.expectRevert(notOwner);
        agentOwner.remove(agentSafe, new address[](0));
        vm.stopPrank();
    }

    function testFuzz_GivenTheSafeHoldsTheToken(uint256 amount, address to) external {
        amount = bound(amount, 1, type(uint128).max);
        vm.assume(to != address(0) && to != agentSafe && to != address(payments));
        usdc.mint(agentSafe, amount);
        uint256 before = usdc.balanceOf(to);
        vm.prank(owner);
        assertEq(agentOwner.sweep(agentSafe, to, address(usdc)), amount);
        assertEq(usdc.balanceOf(agentSafe), 0);
        assertEq(usdc.balanceOf(to) - before, amount);
    }

    /// @dev Any sequence of freeze, unfreeze and key swaps leaves the Safe's one owner as the stored key
    /// while active, and AgentOwner while frozen or removed.
    function testFuzz_TheSafeOwnerFollowsTheAgentsState(uint8[16] calldata steps, uint256 keySeed) external {
        for (uint256 index; index < steps.length; ++index) {
            AgentOwner.Agent memory agent = agentOwner.agentOf(agentSafe);
            uint8 step = steps[index] % 4;
            vm.startPrank(owner);
            if (step == 0 && !agent.frozen) agentOwner.freeze(agentSafe);
            if (step == 1 && agent.frozen) agentOwner.unfreeze(agentSafe);
            if (step == 2) {
                address next = vm.addr(bound(uint256(keccak256(abi.encode(keySeed, index))), 1, 2 ** 128));
                if (next != owner && next != agent.signer) agentOwner.swapSigner(agentSafe, agent.signer, next);
            }
            if (step == 3 && index == steps.length - 1) agentOwner.remove(agentSafe, new address[](0));
            vm.stopPrank();
            agent = agentOwner.agentOf(agentSafe);
            assertEq(_safeOwner(agentSafe), agent.frozen || agent.removed ? address(agentOwner) : agent.signer);
        }
    }
}
