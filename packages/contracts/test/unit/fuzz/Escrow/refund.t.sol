// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IEscrow } from "../../../../src/interfaces/IEscrow.sol";

import { Escrow_Test } from "../../../utils/Escrow/Escrow_Test.sol";

/// @notice Fuzz ranges for trees/Escrow/refund.tree.
contract Refund_Escrow_Unit_Fuzz_Test is Escrow_Test {
    /// @dev Leaf "the caller is not the owner Safe": every other caller.
    function testFuzz_RevertWhen_TheCallerIsNotTheOwnerSafe(address caller) external {
        vm.assume(caller != owner);
        IEscrow escrow = _invoiceEscrow();
        vm.prank(caller);
        vm.expectRevert(IEscrow.NotOwner.selector);
        escrow.refund();
    }

    /// @dev Invoice leaves (S7): a shortfall in [0, amount) is refunded whole; [amount, 1e36] reverts ConditionMet.
    function testFuzz_WhenTheConditionIsInvoiceAmountReached(uint256 amount, uint256 balance) external {
        IEscrow.Terms memory terms = _terms(users.bob, INVOICE);
        terms.amount = bound(amount, 1, 1e36);
        balance = bound(balance, 0, 2e36);
        IEscrow escrow = _escrow(terms);
        usdc.mint(address(escrow), balance);
        uint256 ownerBefore = usdc.balanceOf(owner);
        vm.prank(owner);
        if (balance >= terms.amount) {
            vm.expectRevert(IEscrow.ConditionMet.selector);
            escrow.refund();
            assertEq(usdc.balanceOf(address(escrow)), balance, "nothing moved");
        } else {
            escrow.refund();
            assertEq(usdc.balanceOf(owner) - ownerBefore, balance, "whole balance back");
            assertEq(_state(escrow), uint256(IEscrow.State.Refunded), "refunded");
        }
    }

    /// @dev Claim leaves (S9, D12): any balance, claimed or not, is refunded while open.
    function testFuzz_WhenTheConditionIsPayeeClaimed(uint256 balance, bool claimed) external {
        balance = bound(balance, 0, 1e36);
        IEscrow escrow = _claimEscrow(claimed ? claimedPayee : unclaimedPayee);
        usdc.mint(address(escrow), balance);
        uint256 ownerBefore = usdc.balanceOf(owner);
        vm.prank(owner);
        escrow.refund();
        assertEq(usdc.balanceOf(owner) - ownerBefore, balance, "whole balance back");
        assertEq(_state(escrow), uint256(IEscrow.State.Refunded), "refunded");
    }

    /// @dev Leaf "already paid or refunded": any later deposit goes back to the owner, state unchanged.
    function testFuzz_WhenTheEscrowIsAlreadyPaid(uint256 late) external {
        late = bound(late, 0, 1e36);
        IEscrow escrow = _invoiceEscrow();
        usdc.mint(address(escrow), AMOUNT);
        escrow.payout();
        usdc.mint(address(escrow), late);
        uint256 ownerBefore = usdc.balanceOf(owner);
        vm.prank(owner);
        escrow.refund();
        assertEq(usdc.balanceOf(owner) - ownerBefore, late, "late deposit back");
        assertEq(_state(escrow), uint256(IEscrow.State.Paid), "still paid");
    }
}
