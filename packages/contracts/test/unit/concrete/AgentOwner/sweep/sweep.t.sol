// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { AgentOwner } from "../../../../../src/agents/AgentOwner.sol";
import { IPayments } from "../../../../../src/interfaces/IPayments.sol";
import { MockFalseApproveToken } from "../../../../utils/AgentOwner/AgentMocks.sol";
import { AgentOwner_Test } from "../../../../utils/AgentOwner/AgentOwner_Test.sol";

contract Sweep_AgentOwner_Unit_Concrete_Test is AgentOwner_Test {
    address internal agentSafe;
    uint256 internal constant HELD = 250 * USDC_UNIT;

    function setUp() public override {
        super.setUp();
        agentSafe = _create();
        usdc.mint(agentSafe, HELD);
    }

    function test_WhenTheCallerIsNotTheAgentsOwner() external {
        // it should revert with NotOwner
        vm.prank(users.eve);
        vm.expectRevert(abi.encodeWithSelector(AgentOwner.NotOwner.selector, users.eve));
        agentOwner.sweep(agentSafe, users.eve, address(usdc));
    }

    function test_WhenTheRecipientIsTheZeroAddress() external {
        // it should revert with InvalidRecipient
        vm.prank(owner);
        vm.expectRevert(AgentOwner.InvalidRecipient.selector);
        agentOwner.sweep(agentSafe, address(0), address(usdc));
    }

    function test_WhenTheRecipientIsTheAgentsOwnSafe() external {
        // it should revert with InvalidRecipient
        vm.prank(owner);
        vm.expectRevert(AgentOwner.InvalidRecipient.selector);
        agentOwner.sweep(agentSafe, agentSafe, address(usdc));
    }

    function test_GivenTheSafeHoldsNoneOfTheToken() external {
        // it should call nothing
        vm.recordLogs();
        vm.prank(owner);
        uint256 amount = agentOwner.sweep(agentSafe, owner, address(dai));
        assertEq(vm.getRecordedLogs().length, 0);
        assertEq(agentOwner.sweeps(agentSafe), 0);

        // it should return zero
        assertEq(amount, 0);
    }

    function test_WhenTheTokenRefusesTheApproval() external {
        // it should revert with ModuleCallFailed
        MockFalseApproveToken token = new MockFalseApproveToken();
        token.mint(agentSafe, 1);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(AgentOwner.ModuleCallFailed.selector, agentSafe));
        agentOwner.sweep(agentSafe, owner, address(token));
    }

    function test_WhenThePaymentFails() external {
        // it should revert with ModuleCallFailed
        feeToken.mint(agentSafe, HELD);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(AgentOwner.ModuleCallFailed.selector, agentSafe));
        agentOwner.sweep(agentSafe, owner, address(feeToken));
    }

    function test_GivenTheSafeHoldsTheToken() external {
        IPayments.PaymentItem memory item = _expectedSweep(agentSafe, users.bob, address(usdc), HELD, 1);
        // it should pay the whole balance to the recipient through Payments with the agent sweep kind
        vm.expectEmit(address(payments));
        emit IPayments.PaymentSent(item.paymentId, agentSafe, users.bob, address(usdc), HELD, 9, item.documentHash);
        // it should emit AgentSwept
        vm.expectEmit(address(agentOwner));
        emit AgentOwner.AgentSwept(agentSafe, users.bob, address(usdc), HELD);
        uint256 before = usdc.balanceOf(users.bob);
        vm.prank(owner);
        uint256 amount = agentOwner.sweep(agentSafe, users.bob, address(usdc));

        assertEq(usdc.balanceOf(agentSafe), 0);
        assertEq(usdc.balanceOf(users.bob) - before, HELD);
        assertTrue(payments.paid(item.paymentId));

        // it should count the sweep
        assertEq(agentOwner.sweeps(agentSafe), 1);

        // it should return the amount
        assertEq(amount, HELD);

        // A second sweep is a new payment.
        usdc.mint(agentSafe, 1);
        IPayments.PaymentItem memory second = _expectedSweep(agentSafe, users.bob, address(usdc), 1, 2);
        vm.prank(owner);
        agentOwner.sweep(agentSafe, users.bob, address(usdc));
        assertTrue(payments.paid(second.paymentId));
    }

    function test_GivenTheAgentIsFrozen() external {
        // it should still sweep
        _freeze(agentSafe);
        uint256 before = usdc.balanceOf(owner);
        vm.prank(owner);
        assertEq(agentOwner.sweep(agentSafe, owner, address(usdc)), HELD);
        assertEq(usdc.balanceOf(owner) - before, HELD);
    }
}
