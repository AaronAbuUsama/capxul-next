// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IEscrow } from "../../../../src/interfaces/IEscrow.sol";

import { Escrow_Test } from "../../../utils/Escrow/Escrow_Test.sol";

/// @notice Fuzz ranges for unit/concrete/Escrow/payout/payout.tree.
contract Payout_Escrow_Unit_Fuzz_Test is Escrow_Test {
    /// @dev Leaf "holds at least the amount": the owner gets exactly `amount`, the sender the surplus (S2, S5).
    function testFuzz_WhenTheEscrowHoldsAtLeastTheAmount(uint256 amount, uint256 surplus, address caller) external {
        IEscrow.Terms memory terms = _terms(users.bob, AMOUNT_REACHED);
        terms.amount = bound(amount, 1, 1e36);
        surplus = bound(surplus, 0, 1e36);
        IEscrow escrow = _escrow(terms);
        usdc.mint(address(escrow), terms.amount + surplus);
        uint256 senderBefore = usdc.balanceOf(sender);
        uint256 payeeBefore = usdc.balanceOf(users.bob);

        vm.prank(caller);
        escrow.payout();

        assertEq(usdc.balanceOf(users.bob) - payeeBefore, terms.amount, "owner exact");
        assertEq(usdc.balanceOf(sender) - senderBefore, surplus, "surplus to sender");
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow empty");
        assertEq(_state(escrow), uint256(IEscrow.State.Paid), "paid");
    }

    /// @dev Leaf "holds less than the amount": any shortfall reverts and moves nothing.
    function testFuzz_RevertWhen_TheEscrowHoldsLessThanTheAmount(uint256 amount, uint256 balance) external {
        IEscrow.Terms memory terms = _terms(users.bob, AMOUNT_REACHED);
        terms.amount = bound(amount, 1, 1e36);
        balance = bound(balance, 0, terms.amount - 1);
        IEscrow escrow = _escrow(terms);
        usdc.mint(address(escrow), balance);
        vm.expectRevert(IEscrow.ConditionNotMet.selector);
        escrow.payout();
        assertEq(usdc.balanceOf(address(escrow)), balance, "nothing moved");
        assertEq(_state(escrow), uint256(IEscrow.State.Open), "still open");
    }

    /// @dev Leaf "already paid through Payments": whatever the escrow holds goes back to the sender.
    function testFuzz_GivenThePaymentIdWasAlreadyPaid(uint256 balance) external {
        balance = bound(balance, 0, 1e36);
        IEscrow.Terms memory terms = _terms(users.bob, AMOUNT_REACHED);
        IEscrow escrow = _escrow(terms);
        usdc.mint(address(escrow), balance);
        _payDirectly(terms, address(escrow));
        uint256 senderBefore = usdc.balanceOf(sender);
        uint256 payeeBefore = usdc.balanceOf(users.bob);
        escrow.payout();
        assertEq(usdc.balanceOf(sender) - senderBefore, balance, "all back to the sender");
        assertEq(usdc.balanceOf(users.bob), payeeBefore, "owner not paid twice");
        assertEq(_state(escrow), uint256(IEscrow.State.Paid), "paid");
    }
}
