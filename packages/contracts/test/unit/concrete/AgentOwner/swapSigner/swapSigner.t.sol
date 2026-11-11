// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { AgentOwner } from "../../../../../src/agents/AgentOwner.sol";
import { AgentOwner_Test } from "../../../../utils/AgentOwner/AgentOwner_Test.sol";

contract SwapSigner_AgentOwner_Unit_Concrete_Test is AgentOwner_Test {
    address internal agentSafe;
    address internal newKey = makeAddr("new agent key");

    function setUp() public override {
        super.setUp();
        agentSafe = _create();
    }

    function test_WhenTheCallerIsNotTheAgentsOwner() external {
        // it should revert with NotOwner
        vm.prank(signer);
        vm.expectRevert(abi.encodeWithSelector(AgentOwner.NotOwner.selector, signer));
        agentOwner.swapSigner(agentSafe, signer, newKey);
    }

    function test_WhenTheOldSignerIsNotTheAgentsKey() external {
        // it should revert with SignerMismatch
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(AgentOwner.SignerMismatch.selector, signer, newKey));
        agentOwner.swapSigner(agentSafe, newKey, users.bob);
    }

    function test_WhenTheNewSignerIsNotValid() external {
        // it should revert with InvalidSigner
        address[4] memory invalid = [address(0), SENTINEL_OWNERS, address(agentOwner), owner];
        for (uint256 index; index < invalid.length; ++index) {
            vm.prank(owner);
            vm.expectRevert(AgentOwner.InvalidSigner.selector);
            agentOwner.swapSigner(agentSafe, signer, invalid[index]);
        }
    }

    function test_GivenTheAgentIsActive() external {
        // it should emit AgentSignerSwapped
        vm.expectEmit(address(agentOwner));
        emit AgentOwner.AgentSignerSwapped(agentSafe, signer, newKey);
        vm.prank(owner);
        agentOwner.swapSigner(agentSafe, signer, newKey);

        // it should swap the old key for the new key on the Safe
        assertEq(_safeOwner(agentSafe), newKey);

        // it should record the new key
        assertEq(agentOwner.agentOf(agentSafe).signer, newKey);
    }

    function test_GivenTheAgentIsFrozen() external {
        _freeze(agentSafe);
        // it should emit AgentSignerSwapped
        vm.expectEmit(address(agentOwner));
        emit AgentOwner.AgentSignerSwapped(agentSafe, signer, newKey);
        vm.prank(owner);
        agentOwner.swapSigner(agentSafe, signer, newKey);

        // it should leave AgentOwner as the Safe's owner
        assertEq(_safeOwner(agentSafe), address(agentOwner));

        // it should record the new key, which unfreeze installs
        assertEq(agentOwner.agentOf(agentSafe).signer, newKey);
        vm.prank(owner);
        agentOwner.unfreeze(agentSafe);
        assertEq(_safeOwner(agentSafe), newKey);
    }
}
