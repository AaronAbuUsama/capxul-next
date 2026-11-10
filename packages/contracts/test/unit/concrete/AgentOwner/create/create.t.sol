// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { AgentOwner } from "../../../../../src/agents/AgentOwner.sol";
import { MockAgentSafe } from "../../../../utils/AgentOwner/AgentMocks.sol";
import { AgentOwner_Test } from "../../../../utils/AgentOwner/AgentOwner_Test.sol";

contract Create_AgentOwner_Unit_Concrete_Test is AgentOwner_Test {
    function test_WhenTheCallerIsNotTheOwnerItNames() external {
        // it should revert with NotOwner
        vm.prank(users.eve);
        vm.expectRevert(abi.encodeWithSelector(AgentOwner.NotOwner.selector, users.eve));
        agentOwner.create(signer, owner);
    }

    function test_WhenTheSignerIsTheZeroAddress() external {
        // it should revert with InvalidSigner
        vm.prank(owner);
        vm.expectRevert(AgentOwner.InvalidSigner.selector);
        agentOwner.create(address(0), owner);
    }

    function test_WhenTheSignerIsTheOwnersSentinel() external {
        // it should revert with InvalidSigner
        vm.prank(owner);
        vm.expectRevert(AgentOwner.InvalidSigner.selector);
        agentOwner.create(SENTINEL_OWNERS, owner);
    }

    function test_WhenTheSignerIsAgentOwnerItself() external {
        // it should revert with InvalidSigner
        vm.prank(owner);
        vm.expectRevert(AgentOwner.InvalidSigner.selector);
        agentOwner.create(address(agentOwner), owner);
    }

    function test_WhenTheSignerIsTheOwner() external {
        // it should revert with InvalidSigner
        vm.prank(owner);
        vm.expectRevert(AgentOwner.InvalidSigner.selector);
        agentOwner.create(owner, owner);
    }

    function test_GivenTheDerivedSafeAlreadyBelongsToAnAgent() external {
        // it should revert with AgentExists
        _create();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(AgentOwner.AgentExists.selector, derived));
        agentOwner.create(signer, owner);
    }

    function test_GivenSomeoneDeployedTheDerivedSafeThroughTheFactoryFirst() external {
        _predeploy();
        assertEq(_safeOwner(derived), address(agentOwner));
        assertEq(MockAgentSafe(derived).guard(), address(0));

        // it should record the agent and emit AgentCreated
        vm.expectEmit(address(agentOwner));
        emit AgentOwner.AgentCreated(derived, owner, signer);
        address safe = _create();
        assertEq(safe, derived);
        AgentOwner.Agent memory agent = agentOwner.agentOf(safe);
        assertEq(agent.owner, owner);
        assertEq(agent.signer, signer);

        // it should not call the factory again
        assertEq(factory.calls(), 1);

        // it should make AgentOwner the Safe's transaction guard and module guard
        assertEq(MockAgentSafe(safe).guard(), address(agentOwner));
        assertEq(MockAgentSafe(safe).moduleGuard(), address(agentOwner));

        // it should swap the signer in as the one owner
        assertEq(_safeOwner(safe), signer);
    }

    function test_WhenTheFactoryDeploysAtAnotherAddressThanTheDerivedOne() external {
        // it should revert with DerivedAddressMismatch
        address elsewhere = makeAddr("elsewhere");
        factory.setLanding(elsewhere);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(AgentOwner.DerivedAddressMismatch.selector, derived, elsewhere));
        agentOwner.create(signer, owner);
    }

    function test_WhenTheOwnerCreatesAnAgentForAValidSigner() external {
        // it should emit AgentCreated
        vm.expectEmit(address(agentOwner));
        emit AgentOwner.AgentCreated(derived, owner, signer);
        address safe = _create();

        // it should return the Safe
        assertEq(safe, derived);

        // it should deploy the Safe through the Safe proxy factory with the Safe L2 singleton and the owner and
        // signer salt
        assertEq(factory.calls(), 1);
        assertEq(factory.lastSingleton(), SAFE_L2_SINGLETON);
        assertEq(factory.lastInitializer(), _expectedInitializer());
        assertEq(factory.lastSaltNonce(), uint256(keccak256(abi.encode(owner, signer))));

        // it should set up the Safe with AgentOwner as its one owner, threshold one and the 4337 module as
        // fallback handler
        // it should swap the signer in as the one owner
        MockAgentSafe agentSafe = MockAgentSafe(safe);
        address[] memory owners = agentSafe.getOwners();
        assertEq(owners.length, 1);
        assertEq(owners[0], signer);
        assertEq(agentSafe.threshold(), 1);
        assertEq(agentSafe.fallbackHandler(), SAFE_4337_MODULE);

        // it should enable the 4337 module and AgentOwner as modules
        assertTrue(agentSafe.isModuleEnabled(SAFE_4337_MODULE));
        assertTrue(agentSafe.isModuleEnabled(address(agentOwner)));

        // it should make AgentOwner the Safe's transaction guard and module guard
        assertEq(agentSafe.guard(), address(agentOwner));
        assertEq(agentSafe.moduleGuard(), address(agentOwner));

        // it should record the agent with its owner and signer, not frozen and not removed
        AgentOwner.Agent memory agent = agentOwner.agentOf(safe);
        assertEq(agent.owner, owner);
        assertEq(agent.signer, signer);
        assertFalse(agent.frozen);
        assertFalse(agent.removed);
    }
}
