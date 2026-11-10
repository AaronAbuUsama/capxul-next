// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { AgentOwner } from "../../../../src/agents/AgentOwner.sol";
import { MockAgentSafe } from "../../../utils/AgentOwner/AgentMocks.sol";
import { AgentOwner_Test } from "../../../utils/AgentOwner/AgentOwner_Test.sol";

contract Create_AgentOwner_Unit_Fuzz_Test is AgentOwner_Test {
    function _assumeValid(address key, address by) internal view {
        vm.assume(key != address(0) && key != SENTINEL_OWNERS && key != address(agentOwner) && key != by);
    }

    function testFuzz_RevertWhen_TheCallerIsNotTheOwnerItNames(address caller, address named) external {
        vm.assume(caller != named);
        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(AgentOwner.NotOwner.selector, caller));
        agentOwner.create(signer, named);
    }

    function testFuzz_WhenTheOwnerCreatesAnAgentForAValidSigner(address key, address by) external {
        _assumeValid(key, by);
        address expected = agentOwner.safeAddressFor(key, by);
        vm.assume(expected.code.length == 0);
        factory.setLanding(expected);
        vm.prank(by);
        address created = agentOwner.create(key, by);

        assertEq(created, expected);
        assertEq(MockAgentSafe(created).owner(), key);
        assertTrue(MockAgentSafe(created).isModuleEnabled(address(agentOwner)));
        AgentOwner.Agent memory agent = agentOwner.agentOf(created);
        assertEq(agent.owner, by);
        assertEq(agent.signer, key);
    }

    function testFuzz_SafeAddressForSeparatesEveryOwnerAndSigner(
        address keyA,
        address byA,
        address keyB,
        address byB
    )
        external
        view
    {
        vm.assume(keyA != keyB || byA != byB);
        assertNotEq(agentOwner.safeAddressFor(keyA, byA), agentOwner.safeAddressFor(keyB, byB));
    }
}
