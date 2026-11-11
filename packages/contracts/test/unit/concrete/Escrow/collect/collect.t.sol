// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IEscrow } from "../../../../../src/interfaces/IEscrow.sol";
import { IPayments } from "../../../../../src/interfaces/IPayments.sol";

import { Escrow_Test } from "../../../../utils/Escrow/Escrow_Test.sol";

contract Collect_Escrow_Unit_Concrete_Test is Escrow_Test {
    function test_WhenACallIsAlreadyRunning() external {
        IEscrow.Terms memory terms = _terms(address(claimedPayee), CLAIM);
        terms.token = address(reentrantToken);
        IEscrow escrow = _escrow(terms);
        reentrantToken.mint(address(escrow), AMOUNT);
        reentrantToken.arm(address(escrow), abi.encodeCall(IEscrow.collect, ()));

        vm.prank(address(claimedPayee));
        escrow.collect();

        // it should revert with ReentrantCall
        assertTrue(reentrantToken.reentered(), "the token re-entered");
        assertFalse(reentrantToken.reentrySucceeded(), "the inner collect failed");
        assertEq(reentrantToken.reentryResult(), abi.encodeWithSelector(IEscrow.ReentrantCall.selector));
        assertEq(reentrantToken.balanceOf(address(claimedPayee)), AMOUNT, "the outer collect still paid");
    }

    function test_WhenTheConditionIsNotPayeeClaimed() external {
        IEscrow escrow = _escrow(_terms(address(claimedPayee), INVOICE));
        usdc.mint(address(escrow), AMOUNT);
        // it should revert with InvalidCondition
        vm.prank(address(claimedPayee));
        vm.expectRevert(abi.encodeWithSelector(IEscrow.InvalidCondition.selector, INVOICE));
        escrow.collect();
    }

    function test_WhenTheCallerIsNotThePayeeSafe() external {
        IEscrow escrow = _claimEscrow(claimedPayee);
        usdc.mint(address(escrow), AMOUNT);
        // it should revert with NotPayee
        vm.prank(users.eve);
        vm.expectRevert(IEscrow.NotPayee.selector);
        escrow.collect();
        vm.prank(users.alice); // the payee Safe's owner is not the payee Safe
        vm.expectRevert(IEscrow.NotPayee.selector);
        escrow.collect();
        assertEq(_state(escrow), uint256(IEscrow.State.Open), "still open");
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT, "funds in place");
    }

    function test_WhenTheEscrowIsNotOpen() external {
        IEscrow escrow = _claimEscrow(claimedPayee);
        usdc.mint(address(escrow), AMOUNT);
        vm.prank(address(claimedPayee));
        escrow.collect();
        usdc.mint(address(escrow), AMOUNT);
        // it should revert with JobNotOpen
        vm.prank(address(claimedPayee));
        vm.expectRevert(IEscrow.JobNotOpen.selector);
        escrow.collect();
    }

    function test_WhenThePayeeSafeStillListsCompaniesHouseAsAnOwner() external {
        unclaimedPayee.addOwner(users.alice);
        IEscrow escrow = _claimEscrow(unclaimedPayee);
        usdc.mint(address(escrow), AMOUNT);
        // it should revert with ConditionNotMet
        vm.prank(address(unclaimedPayee));
        vm.expectRevert(IEscrow.ConditionNotMet.selector);
        escrow.collect();
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT, "funds in place");
    }

    function test_GivenThePayeeClaimedAndLaterAddedASecondOwner() external {
        IEscrow escrow = _claimEscrow(unclaimedPayee);
        usdc.mint(address(escrow), AMOUNT);
        unclaimedPayee.swapOwner(companiesHouse, users.alice); // the claim
        unclaimedPayee.addOwner(users.bob); // a recovery key
        // it should still let the payee collect
        vm.prank(address(unclaimedPayee));
        escrow.collect();
        assertEq(usdc.balanceOf(address(unclaimedPayee)), AMOUNT, "collected");
        assertEq(_state(escrow), uint256(IEscrow.State.Paid), "paid");
    }

    function test_WhenTheEscrowHoldsLessThanTheAmount() external {
        IEscrow escrow = _claimEscrow(claimedPayee);
        usdc.mint(address(escrow), AMOUNT - 1);
        // it should revert with InsufficientFunding
        vm.prank(address(claimedPayee));
        vm.expectRevert(IEscrow.InsufficientFunding.selector);
        escrow.collect();
    }

    function test_WhenTheClaimedPayeeCollectsAFundedEscrow() external {
        IEscrow.Terms memory terms = _terms(address(claimedPayee), CLAIM);
        IEscrow escrow = _escrow(terms);
        IPayments.PaymentItem memory item = _item(terms, address(escrow));
        usdc.mint(address(escrow), AMOUNT + 7);
        uint256 ownerBefore = usdc.balanceOf(owner);

        // it should pay the fixed item with the escrow as executor
        vm.expectCall(address(payments), abi.encodeCall(IPayments.send, (item)));
        // it should emit EscrowPaid
        vm.expectEmit(true, true, true, true, address(escrow));
        emit IEscrow.EscrowPaid(owner, address(claimedPayee), item.paymentId, AMOUNT);
        vm.prank(address(claimedPayee));
        escrow.collect();

        // it should mark the escrow paid
        assertEq(_state(escrow), uint256(IEscrow.State.Paid), "state");
        assertEq(item.executor, address(escrow), "executor");
        assertTrue(payments.paid(item.paymentId), "id consumed");
        assertEq(usdc.balanceOf(address(claimedPayee)), AMOUNT, "payee got exactly the amount");
        // it should return any surplus to the owner Safe
        assertEq(usdc.balanceOf(owner) - ownerBefore, 7, "surplus to the owner");
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow empty");
    }

    function test_WhenAnOrdinaryClaimUsesExitPaymentKind() external {
        // it should return the surplus to the owner
        IEscrow.Terms memory terms = _terms(address(claimedPayee), CLAIM);
        terms.kind = 8;
        IEscrow escrow = _escrow(terms);
        usdc.mint(address(escrow), AMOUNT + 7);
        uint256 ownerBefore = usdc.balanceOf(owner);

        vm.prank(address(claimedPayee));
        escrow.collect();

        assertEq(usdc.balanceOf(address(claimedPayee)), AMOUNT, "fixed amount to payee");
        assertEq(usdc.balanceOf(owner) - ownerBefore, 7, "surplus to ordinary escrow owner");
    }

    function test_WhenTheOwnerReturnsAMalformedIdentityResponse() external {
        // it should treat the escrow as an ordinary claim
        ExtraWordEscrowOwner malformedOwner = new ExtraWordEscrowOwner();
        IEscrow.Terms memory terms = _terms(address(claimedPayee), CLAIM);
        terms.kind = 8;
        terms.ownerSafe = address(malformedOwner);
        IEscrow escrow = _escrow(terms);
        usdc.mint(address(escrow), AMOUNT + 7);

        vm.prank(address(claimedPayee));
        escrow.collect();

        assertEq(usdc.balanceOf(address(claimedPayee)), AMOUNT, "fixed amount to payee");
        assertEq(usdc.balanceOf(address(malformedOwner)), 7, "surplus to ordinary owner");
    }
}

contract ExtraWordEscrowOwner {
    fallback() external {
        assembly ("memory-safe") {
            mstore(0, 1)
            mstore(32, 1)
            return(0, 64)
        }
    }
}
