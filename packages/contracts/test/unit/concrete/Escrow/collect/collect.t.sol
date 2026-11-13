// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IEscrow } from "../../../../../src/interfaces/IEscrow.sol";
import { IPayments } from "../../../../../src/interfaces/IPayments.sol";

import { Escrow_Test } from "../../../../utils/Escrow/Escrow_Test.sol";

contract Collect_Escrow_Unit_Concrete_Test is Escrow_Test {
    function test_WhenACallIsAlreadyRunning() external {
        IEscrow.Terms memory terms = _terms(address(claimedOwner), OWNER_COLLECTS);
        terms.token = address(reentrantToken);
        IEscrow escrow = _escrow(terms);
        reentrantToken.mint(address(escrow), AMOUNT);
        reentrantToken.arm(address(escrow), abi.encodeCall(IEscrow.collect, ()));

        vm.prank(address(claimedOwner));
        escrow.collect();

        // it should revert with ReentrantCall
        assertTrue(reentrantToken.reentered(), "the token re-entered");
        assertFalse(reentrantToken.reentrySucceeded(), "the inner collect failed");
        assertEq(reentrantToken.reentryResult(), abi.encodeWithSelector(IEscrow.ReentrantCall.selector));
        assertEq(reentrantToken.balanceOf(address(claimedOwner)), AMOUNT, "the outer collect still paid");
    }

    function test_WhenTheConditionIsNotOwnerCollects() external {
        IEscrow escrow = _escrow(_terms(address(claimedOwner), AMOUNT_REACHED));
        usdc.mint(address(escrow), AMOUNT);
        // it should revert with InvalidCondition
        vm.prank(address(claimedOwner));
        vm.expectRevert(abi.encodeWithSelector(IEscrow.InvalidCondition.selector, AMOUNT_REACHED));
        escrow.collect();
    }

    function test_WhenTheCallerIsNotTheOwner() external {
        IEscrow escrow = _escrow(_departmentTerms(address(claimedOwner)));
        usdc.mint(address(escrow), AMOUNT);
        authority.admit(BUDGET_ID, users.jordan);
        // it should revert with NotOwner, for the sender and an admitted authority caller too
        address[4] memory callers = [users.eve, users.alice, sender, users.jordan];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]); // users.alice owns the owner Safe but is not it
            vm.expectRevert(IEscrow.NotOwner.selector);
            escrow.collect();
        }
        assertEq(_state(escrow), uint256(IEscrow.State.Open), "still open");
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT, "funds in place");
    }

    function test_WhenTheEscrowIsNotOpen() external {
        IEscrow escrow = _claimEscrow(claimedOwner);
        usdc.mint(address(escrow), AMOUNT);
        vm.prank(address(claimedOwner));
        escrow.collect();
        usdc.mint(address(escrow), AMOUNT);
        // it should revert with JobNotOpen
        vm.prank(address(claimedOwner));
        vm.expectRevert(IEscrow.JobNotOpen.selector);
        escrow.collect();

        IEscrow refunded = _claimEscrow(claimedOwner);
        usdc.mint(address(refunded), AMOUNT);
        vm.prank(sender);
        refunded.refund();
        usdc.mint(address(refunded), AMOUNT);
        vm.prank(address(claimedOwner));
        vm.expectRevert(IEscrow.JobNotOpen.selector);
        refunded.collect();
    }

    function test_WhenTheOwnerStillListsTheBootstrapOwnerAsAnOwner() external {
        unclaimedOwner.addOwner(users.alice);
        IEscrow escrow = _claimEscrow(unclaimedOwner);
        usdc.mint(address(escrow), AMOUNT);
        // it should revert with ConditionNotMet
        vm.prank(address(unclaimedOwner));
        vm.expectRevert(IEscrow.ConditionNotMet.selector);
        escrow.collect();
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT, "funds in place");
    }

    function test_GivenTheOwnerClaimedAndLaterAddedASecondOwner() external {
        IEscrow escrow = _claimEscrow(unclaimedOwner);
        usdc.mint(address(escrow), AMOUNT);
        unclaimedOwner.swapOwner(companiesHouse, users.alice); // the claim
        unclaimedOwner.addOwner(users.bob); // a recovery key
        // it should still let the owner collect
        vm.prank(address(unclaimedOwner));
        escrow.collect();
        assertEq(usdc.balanceOf(address(unclaimedOwner)), AMOUNT, "collected");
        assertEq(_state(escrow), uint256(IEscrow.State.Paid), "paid");
    }

    function test_GivenTheOwnerIsAPlainAccountAndTheBootstrapOwnerTermIsZero() external {
        IEscrow.Terms memory terms = _terms(users.bob, OWNER_COLLECTS);
        terms.bootstrapOwner = address(0);
        IEscrow escrow = _escrow(terms);
        usdc.mint(address(escrow), AMOUNT);
        uint256 before = usdc.balanceOf(users.bob);
        // it should let the owner collect
        vm.prank(users.bob);
        escrow.collect();
        assertEq(usdc.balanceOf(users.bob) - before, AMOUNT, "collected by an account with no code");
    }

    function test_WhenTheEscrowHoldsLessThanTheAmount() external {
        IEscrow escrow = _claimEscrow(claimedOwner);
        usdc.mint(address(escrow), AMOUNT - 1);
        // it should revert with InsufficientFunding
        vm.prank(address(claimedOwner));
        vm.expectRevert(IEscrow.InsufficientFunding.selector);
        escrow.collect();
    }

    function test_WhenTheClaimedOwnerCollectsAFundedEscrow() external {
        IEscrow.Terms memory terms = _terms(address(claimedOwner), OWNER_COLLECTS);
        IEscrow escrow = _escrow(terms);
        IPayments.PaymentItem memory item = _item(terms, address(escrow));
        usdc.mint(address(escrow), AMOUNT + 7);
        uint256 senderBefore = usdc.balanceOf(sender);

        // it should pay the fixed item with the escrow as executor
        vm.expectCall(address(payments), abi.encodeCall(IPayments.send, (item)));
        // it should emit EscrowPaid
        vm.expectEmit(true, true, true, true, address(escrow));
        emit IEscrow.EscrowPaid(address(claimedOwner), sender, item.paymentId, AMOUNT);
        vm.prank(address(claimedOwner));
        escrow.collect();

        // it should mark the escrow paid
        assertEq(_state(escrow), uint256(IEscrow.State.Paid), "state");
        assertEq(item.executor, address(escrow), "executor");
        assertTrue(payments.paid(item.paymentId), "id consumed");
        assertEq(usdc.balanceOf(address(claimedOwner)), AMOUNT, "owner got exactly the amount");
        // it should return any surplus to the sender
        assertEq(usdc.balanceOf(sender) - senderBefore, 7, "surplus to the sender");
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow empty");
    }

    function test_GivenOwnerTakesSurplus() external {
        IEscrow.Terms memory terms = _terms(address(claimedOwner), OWNER_COLLECTS);
        terms.ownerTakesSurplus = true;
        IEscrow escrow = _escrow(terms);
        IPayments.PaymentItem memory item = _item(terms, address(escrow));
        usdc.mint(address(escrow), AMOUNT + 7);
        uint256 senderBefore = usdc.balanceOf(sender);

        // it should pay the amount through Payments and the surplus to the owner
        vm.expectCall(address(payments), abi.encodeCall(IPayments.send, (item)));
        vm.prank(address(claimedOwner));
        escrow.collect();
        assertEq(usdc.balanceOf(address(claimedOwner)), AMOUNT + 7, "owner got amount and surplus");
        assertEq(usdc.balanceOf(sender), senderBefore, "sender got nothing");
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow empty");
    }

    function test_WhenTheTokenTakesAFeeOnTransfer() external {
        // A fee-on-transfer token: Payments already refuses an inexact amount, so the whole call fails.
        IEscrow.Terms memory terms = _terms(address(claimedOwner), OWNER_COLLECTS);
        terms.token = address(feeToken);
        terms.ownerTakesSurplus = true;
        IEscrow escrow = _escrow(terms);
        feeToken.mint(address(escrow), AMOUNT + 7);
        // it should revert with InexactTransfer and leave the escrow open
        vm.prank(address(claimedOwner));
        vm.expectPartialRevert(IPayments.InexactTransfer.selector);
        escrow.collect();
        assertEq(_state(escrow), uint256(IEscrow.State.Open), "still open");
    }

    function test_GivenNoDeadline() external {
        IEscrow escrow = _claimEscrow(claimedOwner);
        usdc.mint(address(escrow), AMOUNT);
        // it should let the owner collect after any time has passed
        vm.warp(block.timestamp + 100 * 365 days);
        vm.roll(block.number + 50_000_000);
        vm.prank(address(claimedOwner));
        escrow.collect();
        assertEq(_state(escrow), uint256(IEscrow.State.Paid), "collected a century later");
    }
}
