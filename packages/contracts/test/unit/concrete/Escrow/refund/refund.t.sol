// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IEscrow } from "../../../../../src/interfaces/IEscrow.sol";

import { Escrow_Test } from "../../../../utils/Escrow/Escrow_Test.sol";

contract Refund_Escrow_Unit_Concrete_Test is Escrow_Test {
    function test_WhenTheTokenRefusesTheRefund() external {
        // it should revert and leave the escrow open and funded
        IEscrow escrow = _claimEscrow(unclaimedOwner);
        usdc.mint(address(escrow), AMOUNT);
        bytes memory transfer = abi.encodeCall(IERC20.transfer, (sender, AMOUNT));
        bytes memory reason = abi.encodeWithSignature("Error(string)", "blocked");
        vm.mockCallRevert(address(usdc), transfer, reason);
        vm.expectRevert(reason);
        vm.prank(sender);
        escrow.refund();
        assertEq(_state(escrow), uint256(IEscrow.State.Open), "still open");
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT, "still funded");

        vm.clearMockedCalls();
        vm.mockCall(address(usdc), transfer, abi.encode(false));
        vm.expectRevert(abi.encodeWithSelector(IEscrow.TokenCallReturnedFalse.selector, address(usdc)));
        vm.prank(sender);
        escrow.refund();
        assertEq(_state(escrow), uint256(IEscrow.State.Open), "still open after false return");
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT, "still funded after false return");
    }

    function test_WhenACallIsAlreadyRunning() external {
        IEscrow.Terms memory terms = _terms(users.bob, AMOUNT_REACHED);
        terms.token = address(reentrantToken);
        IEscrow escrow = _escrow(terms);
        reentrantToken.mint(address(escrow), AMOUNT - 1);
        reentrantToken.arm(address(escrow), abi.encodeCall(IEscrow.refund, ()));

        vm.prank(sender);
        escrow.refund();

        // it should revert with ReentrantCall
        assertTrue(reentrantToken.reentered(), "the token re-entered");
        assertFalse(reentrantToken.reentrySucceeded(), "the inner refund failed");
        assertEq(reentrantToken.reentryResult(), abi.encodeWithSelector(IEscrow.ReentrantCall.selector));
        assertEq(reentrantToken.balanceOf(address(escrow)), 0, "the outer refund still emptied the escrow");
    }

    modifier whenTheEscrowIsOpenAndItsConditionIsAmountReached() {
        _;
    }

    function test_WhenItHoldsTheAmount() external whenTheEscrowIsOpenAndItsConditionIsAmountReached {
        IEscrow escrow = _invoiceEscrow();
        usdc.mint(address(escrow), AMOUNT);
        // it should revert with ConditionMet
        vm.prank(sender);
        vm.expectRevert(IEscrow.ConditionMet.selector);
        escrow.refund();
    }

    function test_WhenItHoldsLessThanTheAmount() external whenTheEscrowIsOpenAndItsConditionIsAmountReached {
        IEscrow escrow = _invoiceEscrow();
        usdc.mint(address(escrow), AMOUNT - 1);
        uint256 senderBefore = usdc.balanceOf(sender);

        // it should emit EscrowRefunded
        vm.expectEmit(true, true, true, true, address(escrow));
        emit IEscrow.EscrowRefunded(sender, sender, escrow.paymentId(), AMOUNT - 1, IEscrow.State.Refunded);
        vm.prank(sender);
        escrow.refund();

        // it should mark the escrow refunded
        assertEq(_state(escrow), uint256(IEscrow.State.Refunded), "state");
        // it should return the whole balance to the sender
        assertEq(usdc.balanceOf(sender) - senderBefore, AMOUNT - 1, "sender refunded");
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow empty");
    }

    modifier whenTheEscrowIsOpenAndItsConditionIsOwnerCollects() {
        _;
    }

    function test_GivenTheOwnerCannotActYet() external whenTheEscrowIsOpenAndItsConditionIsOwnerCollects {
        IEscrow escrow = _claimEscrow(unclaimedOwner);
        usdc.mint(address(escrow), AMOUNT + 7);
        uint256 senderBefore = usdc.balanceOf(sender);

        // it should emit EscrowRefunded
        vm.expectEmit(true, true, true, true, address(escrow));
        emit IEscrow.EscrowRefunded(sender, sender, escrow.paymentId(), AMOUNT + 7, IEscrow.State.Refunded);
        vm.prank(sender);
        escrow.refund();

        // it should mark the escrow refunded
        assertEq(_state(escrow), uint256(IEscrow.State.Refunded), "state");
        // it should return the whole balance to the sender
        assertEq(usdc.balanceOf(sender) - senderBefore, AMOUNT + 7, "sender refunded");
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow empty");
    }

    function test_GivenTheOwnerCanActButHasNotCollected() external whenTheEscrowIsOpenAndItsConditionIsOwnerCollects {
        IEscrow escrow = _claimEscrow(claimedOwner);
        usdc.mint(address(escrow), AMOUNT + 7);
        assertTrue(escrow.conditionMet(), "the owner can act");
        uint256 senderBefore = usdc.balanceOf(sender);

        // it should emit EscrowRefunded
        vm.expectEmit(true, true, true, true, address(escrow));
        emit IEscrow.EscrowRefunded(sender, sender, escrow.paymentId(), AMOUNT + 7, IEscrow.State.Refunded);
        vm.prank(sender);
        escrow.refund();

        // it should mark the escrow refunded
        assertEq(_state(escrow), uint256(IEscrow.State.Refunded), "state");
        // it should return the whole balance to the sender
        assertEq(usdc.balanceOf(sender) - senderBefore, AMOUNT + 7, "sender refunded");
        assertEq(usdc.balanceOf(address(claimedOwner)), 0, "owner got nothing");
        assertFalse(payments.paid(escrow.paymentId()), "id not consumed");
        // it should make a later collect revert with JobNotOpen
        usdc.mint(address(escrow), AMOUNT);
        vm.prank(address(claimedOwner));
        vm.expectRevert(IEscrow.JobNotOpen.selector);
        escrow.collect();
    }

    function test_WhenTheEscrowIsOpenAndEmpty() external {
        IEscrow escrow = _claimEscrow(claimedOwner);
        // it should still close it as refunded, so a later funding cannot be collected
        vm.expectEmit(true, true, true, true, address(escrow));
        emit IEscrow.EscrowRefunded(sender, sender, escrow.paymentId(), 0, IEscrow.State.Refunded);
        vm.prank(sender);
        escrow.refund();
        assertEq(_state(escrow), uint256(IEscrow.State.Refunded), "closed");
        usdc.mint(address(escrow), AMOUNT);
        vm.prank(address(claimedOwner));
        vm.expectRevert(IEscrow.JobNotOpen.selector);
        escrow.collect();
    }

    function test_WhenTheEscrowIsAlreadyPaidOrRefunded() external {
        // Paid: a claim escrow the owner collected.
        IEscrow paid = _escrow(_departmentTerms(address(claimedOwner)));
        usdc.mint(address(paid), AMOUNT);
        vm.prank(address(claimedOwner));
        paid.collect();
        usdc.mint(address(paid), 11);
        uint256 senderBefore = usdc.balanceOf(sender);

        // it should still refuse a caller who may not refund
        vm.prank(address(claimedOwner));
        vm.expectRevert(abi.encodeWithSelector(IEscrow.CannotRefund.selector, address(claimedOwner)));
        paid.refund();

        // it should emit EscrowRefunded with the state unchanged
        authority.admit(BUDGET_ID, users.jordan);
        vm.expectEmit(true, true, true, true, address(paid));
        emit IEscrow.EscrowRefunded(sender, users.jordan, paid.paymentId(), 11, IEscrow.State.Paid);
        vm.prank(users.jordan);
        paid.refund();
        // it should return any balance sent to it since to the sender
        assertEq(usdc.balanceOf(sender) - senderBefore, 11, "late deposit returned");
        assertEq(_state(paid), uint256(IEscrow.State.Paid), "still paid");
        assertEq(usdc.balanceOf(address(claimedOwner)), AMOUNT, "owner keeps the payment");

        // Refunded: an invoice escrow refunded short, then topped up past the amount.
        IEscrow refunded = _invoiceEscrow();
        usdc.mint(address(refunded), 1);
        vm.prank(sender);
        refunded.refund();
        usdc.mint(address(refunded), AMOUNT);
        senderBefore = usdc.balanceOf(sender);
        vm.expectEmit(true, true, true, true, address(refunded));
        emit IEscrow.EscrowRefunded(sender, sender, refunded.paymentId(), AMOUNT, IEscrow.State.Refunded);
        vm.prank(sender);
        refunded.refund();
        assertEq(usdc.balanceOf(sender) - senderBefore, AMOUNT, "late deposit returned");
        assertEq(_state(refunded), uint256(IEscrow.State.Refunded), "still refunded");
        assertEq(usdc.balanceOf(address(refunded)), 0, "escrow empty");
    }
}
