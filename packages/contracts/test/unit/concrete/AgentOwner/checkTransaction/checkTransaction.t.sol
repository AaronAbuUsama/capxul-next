// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { AgentOwner } from "../../../../../src/agents/AgentOwner.sol";
import { AgentOwner_Test } from "../../../../utils/AgentOwner/AgentOwner_Test.sol";

contract CheckTransaction_AgentOwner_Unit_Concrete_Test is AgentOwner_Test {
    address internal agentSafe;

    function setUp() public override {
        super.setUp();
        agentSafe = _create();
    }

    function _check(address to, uint8 operation) internal {
        vm.prank(agentSafe);
        agentOwner.checkTransaction(to, 0, "", operation, 0, 0, 0, address(0), payable(address(0)), "", signer);
    }

    function test_WhenTheTransactionCallsTheAgentsOwnSafe() external {
        // it should revert with AgentSelfCall
        vm.expectRevert(abi.encodeWithSelector(AgentOwner.AgentSelfCall.selector, agentSafe, agentSafe, uint8(0)));
        _check(agentSafe, 0);
    }

    function test_WhenTheTransactionIsADelegatecall() external {
        // it should revert with AgentSelfCall
        vm.expectRevert(abi.encodeWithSelector(AgentOwner.AgentSelfCall.selector, agentSafe, users.bob, uint8(1)));
        _check(users.bob, 1);
    }

    function test_WhenTheTransactionCallsAnotherAddress() external {
        // it should pass
        _check(users.bob, 0);
    }

    function test_WhenTheTransactionHasRun() external view {
        // it should check nothing after it
        agentOwner.checkAfterExecution(bytes32(0), true);
    }
}
