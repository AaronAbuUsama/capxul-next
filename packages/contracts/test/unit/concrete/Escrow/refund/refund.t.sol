// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IEscrow } from "../../../../../src/interfaces/IEscrow.sol";

import { Escrow_Test } from "../../../../utils/Escrow/Escrow_Test.sol";

contract Refund_Escrow_Unit_Concrete_Test is Escrow_Test {
    function test_WhenTheTokenRefusesTheRefund() external {
        // it should revert and leave the escrow open and funded
        IEscrow escrow = _claimEscrow(unclaimedPayee);
        usdc.mint(address(escrow), AMOUNT);
        bytes memory transfer = abi.encodeCall(IERC20.transfer, (owner, AMOUNT));
        bytes memory reason = abi.encodeWithSignature("Error(string)", "blocked");
        vm.mockCallRevert(address(usdc), transfer, reason);
        vm.expectRevert(reason);
        vm.prank(owner);
        escrow.refund();
        assertEq(_state(escrow), uint256(IEscrow.State.Open), "still open");
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT, "still funded");

        vm.clearMockedCalls();
        vm.mockCall(address(usdc), transfer, abi.encode(false));
        vm.expectRevert(abi.encodeWithSelector(IEscrow.TokenCallReturnedFalse.selector, address(usdc)));
        vm.prank(owner);
        escrow.refund();
        assertEq(_state(escrow), uint256(IEscrow.State.Open), "still open after false return");
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT, "still funded after false return");
    }

    function test_WhenACallIsAlreadyRunning() external {
        IEscrow.Terms memory terms = _terms(users.bob, INVOICE);
        terms.token = address(reentrantToken);
        IEscrow escrow = _escrow(terms);
        reentrantToken.mint(address(escrow), AMOUNT - 1);
        reentrantToken.arm(address(escrow), abi.encodeCall(IEscrow.refund, ()));

        vm.prank(owner);
        escrow.refund();

        // it should revert with ReentrantCall
        assertTrue(reentrantToken.reentered(), "the token re-entered");
        assertFalse(reentrantToken.reentrySucceeded(), "the inner refund failed");
        assertEq(reentrantToken.reentryResult(), abi.encodeWithSelector(IEscrow.ReentrantCall.selector));
        assertEq(reentrantToken.balanceOf(address(escrow)), 0, "the outer refund still emptied the escrow");
    }

    function test_WhenTheCallerIsNotTheOwnerSafe() external {
        IEscrow escrow = _invoiceEscrow();
        usdc.mint(address(escrow), 1);
        // it should revert with NotOwner
        vm.prank(users.eve);
        vm.expectRevert(IEscrow.NotOwner.selector);
        escrow.refund();
        vm.prank(users.bob); // not even the payee
        vm.expectRevert(IEscrow.NotOwner.selector);
        escrow.refund();
    }

    modifier whenTheEscrowIsOpenAndItsConditionIsInvoiceAmountReached() {
        _;
    }

    function test_WhenItHoldsTheAmount() external whenTheEscrowIsOpenAndItsConditionIsInvoiceAmountReached {
        IEscrow escrow = _invoiceEscrow();
        usdc.mint(address(escrow), AMOUNT);
        // it should revert with ConditionMet
        vm.prank(owner);
        vm.expectRevert(IEscrow.ConditionMet.selector);
        escrow.refund();
    }

    function test_WhenItHoldsLessThanTheAmount() external whenTheEscrowIsOpenAndItsConditionIsInvoiceAmountReached {
        IEscrow escrow = _invoiceEscrow();
        usdc.mint(address(escrow), AMOUNT - 1);
        uint256 ownerBefore = usdc.balanceOf(owner);

        // it should emit EscrowRefunded
        vm.expectEmit(true, true, true, true, address(escrow));
        emit IEscrow.EscrowRefunded(owner, escrow.paymentId(), AMOUNT - 1, IEscrow.State.Refunded);
        vm.prank(owner);
        escrow.refund();

        // it should mark the escrow refunded
        assertEq(_state(escrow), uint256(IEscrow.State.Refunded), "state");
        // it should return the whole balance to the owner Safe
        assertEq(usdc.balanceOf(owner) - ownerBefore, AMOUNT - 1, "owner refunded");
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow empty");
    }

    modifier whenTheEscrowIsOpenAndItsConditionIsPayeeClaimed() {
        _;
    }

    function test_GivenThePayeeHasNotClaimed() external whenTheEscrowIsOpenAndItsConditionIsPayeeClaimed {
        IEscrow escrow = _claimEscrow(unclaimedPayee);
        usdc.mint(address(escrow), AMOUNT + 7);
        uint256 ownerBefore = usdc.balanceOf(owner);

        // it should emit EscrowRefunded
        vm.expectEmit(true, true, true, true, address(escrow));
        emit IEscrow.EscrowRefunded(owner, escrow.paymentId(), AMOUNT + 7, IEscrow.State.Refunded);
        vm.prank(owner);
        escrow.refund();

        // it should mark the escrow refunded
        assertEq(_state(escrow), uint256(IEscrow.State.Refunded), "state");
        // it should return the whole balance to the owner Safe
        assertEq(usdc.balanceOf(owner) - ownerBefore, AMOUNT + 7, "owner refunded");
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow empty");
    }

    function test_GivenThePayeeHasClaimedButNotCollected() external whenTheEscrowIsOpenAndItsConditionIsPayeeClaimed {
        IEscrow escrow = _claimEscrow(claimedPayee);
        usdc.mint(address(escrow), AMOUNT + 7);
        assertTrue(escrow.conditionMet(), "the payee has claimed");
        uint256 ownerBefore = usdc.balanceOf(owner);

        // it should emit EscrowRefunded
        vm.expectEmit(true, true, true, true, address(escrow));
        emit IEscrow.EscrowRefunded(owner, escrow.paymentId(), AMOUNT + 7, IEscrow.State.Refunded);
        vm.prank(owner);
        escrow.refund();

        // it should mark the escrow refunded
        assertEq(_state(escrow), uint256(IEscrow.State.Refunded), "state");
        // it should return the whole balance to the owner Safe
        assertEq(usdc.balanceOf(owner) - ownerBefore, AMOUNT + 7, "owner refunded");
        assertEq(usdc.balanceOf(address(claimedPayee)), 0, "payee got nothing");
        assertFalse(payments.paid(escrow.paymentId()), "id not consumed");
        // it should make a later collect revert with JobNotOpen
        usdc.mint(address(escrow), AMOUNT);
        vm.prank(address(claimedPayee));
        vm.expectRevert(IEscrow.JobNotOpen.selector);
        escrow.collect();
    }

    function test_WhenTheEscrowIsAlreadyPaidOrRefunded() external {
        // Paid: a claim escrow the payee collected.
        IEscrow paid = _claimEscrow(claimedPayee);
        usdc.mint(address(paid), AMOUNT);
        vm.prank(address(claimedPayee));
        paid.collect();
        usdc.mint(address(paid), 11);
        uint256 ownerBefore = usdc.balanceOf(owner);

        // it should emit EscrowRefunded with the state unchanged
        vm.expectEmit(true, true, true, true, address(paid));
        emit IEscrow.EscrowRefunded(owner, paid.paymentId(), 11, IEscrow.State.Paid);
        vm.prank(owner);
        paid.refund();
        // it should return any balance sent to it since to the owner Safe
        assertEq(usdc.balanceOf(owner) - ownerBefore, 11, "late deposit returned");
        assertEq(_state(paid), uint256(IEscrow.State.Paid), "still paid");
        assertEq(usdc.balanceOf(address(claimedPayee)), AMOUNT, "payee keeps the payment");

        // Refunded: an invoice escrow refunded short, then topped up past the amount.
        IEscrow refunded = _invoiceEscrow();
        usdc.mint(address(refunded), 1);
        vm.prank(owner);
        refunded.refund();
        usdc.mint(address(refunded), AMOUNT);
        ownerBefore = usdc.balanceOf(owner);
        vm.expectEmit(true, true, true, true, address(refunded));
        emit IEscrow.EscrowRefunded(owner, refunded.paymentId(), AMOUNT, IEscrow.State.Refunded);
        vm.prank(owner);
        refunded.refund();
        assertEq(usdc.balanceOf(owner) - ownerBefore, AMOUNT, "late deposit returned");
        assertEq(_state(refunded), uint256(IEscrow.State.Refunded), "still refunded");
        assertEq(usdc.balanceOf(address(refunded)), 0, "escrow empty");
    }
}
