// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IEscrow } from "../../../../src/interfaces/IEscrow.sol";

import { Escrow_Test } from "../../../utils/Escrow/Escrow_Test.sol";
import { RawAnswerTarget } from "../../../utils/Escrow/RawAnswerTarget.sol";

/// @notice Fuzz ranges for unit/concrete/Escrow/refund/refund.tree.
contract Refund_Escrow_Unit_Fuzz_Test is Escrow_Test {
    /// @dev Leaf "neither the sender nor admitted": every other caller (G6).
    function testFuzz_RevertWhen_TheCallerMayNotRefund(address caller) external {
        vm.assume(caller != sender);
        IEscrow escrow = _escrow(_departmentTerms(address(claimedOwner)));
        usdc.mint(address(escrow), AMOUNT);
        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(IEscrow.CannotRefund.selector, caller));
        escrow.refund();
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT, "nothing moved");
    }

    /// @dev The authority term fails closed over any answer: a caller other than the sender is admitted iff the
    /// authority returns exactly the 32-byte word 1. `canRefund` and `refund` agree on every answer.
    function testFuzz_WhenTheAuthorityAnswersAnyBytes(bytes calldata answer, bool reverts, address caller) external {
        vm.assume(caller != sender);
        RawAnswerTarget target = new RawAnswerTarget();
        target.set(answer, reverts);
        IEscrow.Terms memory terms = _departmentTerms(address(claimedOwner));
        terms.authority = address(target);
        IEscrow escrow = _escrow(terms);
        usdc.mint(address(escrow), AMOUNT);

        bool expected = !reverts && answer.length == 32 && uint256(bytes32(answer)) == 1;
        assertEq(escrow.canRefund(caller), expected, "canRefund");
        uint256 senderBefore = usdc.balanceOf(sender);
        vm.prank(caller);
        (bool ok, bytes memory data) = address(escrow).call(abi.encodeCall(IEscrow.refund, ()));
        assertEq(ok, expected, "refund agrees with canRefund");
        if (ok) {
            assertEq(usdc.balanceOf(sender) - senderBefore, AMOUNT, "to the sender");
            assertEq(_state(escrow), uint256(IEscrow.State.Refunded), "refunded");
        } else {
            assertEq(data, abi.encodeWithSelector(IEscrow.CannotRefund.selector, caller), "CannotRefund");
            assertEq(_state(escrow), uint256(IEscrow.State.Open), "still open");
        }
    }

    /// @dev Amount-reached leaves (G11, S7): a shortfall in [0, amount) is refunded whole; [amount, 2e36] reverts
    /// ConditionMet, whoever may refund.
    function testFuzz_WhenTheConditionIsAmountReached(uint256 amount, uint256 balance, bool bySender) external {
        IEscrow.Terms memory terms = _terms(users.bob, AMOUNT_REACHED);
        terms.authority = address(authority);
        terms.authorityKey = BUDGET_ID;
        terms.amount = bound(amount, 1, 1e36);
        balance = bound(balance, 0, 2e36);
        IEscrow escrow = _escrow(terms);
        authority.admit(BUDGET_ID, users.jordan);
        usdc.mint(address(escrow), balance);
        uint256 senderBefore = usdc.balanceOf(sender);
        vm.prank(bySender ? sender : users.jordan);
        if (balance >= terms.amount) {
            vm.expectRevert(IEscrow.ConditionMet.selector);
            escrow.refund();
            assertEq(usdc.balanceOf(address(escrow)), balance, "nothing moved");
        } else {
            escrow.refund();
            assertEq(usdc.balanceOf(sender) - senderBefore, balance, "whole balance back");
            assertEq(_state(escrow), uint256(IEscrow.State.Refunded), "refunded");
        }
    }

    /// @dev Owner-collects leaves (G6, D12): any balance, the owner able to act or not, is refunded while open.
    function testFuzz_WhenTheConditionIsOwnerCollects(uint256 balance, bool canAct, bool bySender) external {
        balance = bound(balance, 0, 1e36);
        IEscrow escrow = _escrow(_departmentTerms(address(canAct ? claimedOwner : unclaimedOwner)));
        authority.admit(BUDGET_ID, users.jordan);
        usdc.mint(address(escrow), balance);
        uint256 senderBefore = usdc.balanceOf(sender);
        vm.prank(bySender ? sender : users.jordan);
        escrow.refund();
        assertEq(usdc.balanceOf(sender) - senderBefore, balance, "whole balance back");
        assertEq(_state(escrow), uint256(IEscrow.State.Refunded), "refunded");
    }

    /// @dev Leaf "already paid or refunded": any later deposit goes back to the sender, state unchanged.
    function testFuzz_WhenTheEscrowIsAlreadyPaid(uint256 late) external {
        late = bound(late, 0, 1e36);
        IEscrow escrow = _invoiceEscrow();
        usdc.mint(address(escrow), AMOUNT);
        escrow.payout();
        usdc.mint(address(escrow), late);
        uint256 senderBefore = usdc.balanceOf(sender);
        vm.prank(sender);
        escrow.refund();
        assertEq(usdc.balanceOf(sender) - senderBefore, late, "late deposit back");
        assertEq(_state(escrow), uint256(IEscrow.State.Paid), "still paid");
    }
}
