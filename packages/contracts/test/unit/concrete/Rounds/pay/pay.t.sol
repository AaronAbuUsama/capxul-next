// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICaptable } from "../../../../../src/interfaces/ICaptable.sol";
import { IPayments } from "../../../../../src/interfaces/IPayments.sol";
import { IRounds } from "../../../../../src/interfaces/IRounds.sol";
import { Vm } from "forge-std/Vm.sol";
import { MockERC20 } from "../../../../mocks/MockERC20.sol";
import { Rounds_Shared_Test } from "../../../../utils/Rounds/Rounds_Shared_Test.sol";

/// @dev spec/rounds.md `pay`; invariants R1 (restated by ruling D14: exactly `shares * price`, exactly
/// `shares`, never rounded), R2 (shares in the same call as the payment, never without it) and R3; ruling D6
/// (a pending proposal in the round's class refuses the issue, so the whole pay reverts). The Series C investor
/// pays 4,000,000 x $2.3724 = $9,489,600 exactly. A round that is closed or cancelled refuses before its
/// pay-by date is looked at. The payment's document hash is the round's.
contract Pay_Rounds_Unit_Concrete_Test is Rounds_Shared_Test {
    function test_WhenTheInvestorHasNoAllocation() external {
        // it should revert with NotAllocated
        uint256 id = _createPricedRound(SERIES_C, PRICE, MAX_SHARES);
        _invite(id, users.investor, INVITED);
        _commit(id, users.investor, INVITED);
        _expectNoPaymentOrIssue();
        vm.expectRevert(IRounds.NotAllocated.selector);
        vm.prank(users.investor);
        rounds.pay(id);
        vm.expectRevert(IRounds.NotAllocated.selector);
        vm.prank(users.eve);
        rounds.pay(id);
    }

    function test_WhenTheInvestorAlreadyPaid() external {
        // it should revert with AlreadyPaid
        uint256 id = _defaultAllocated();
        _pay(id, users.investor);
        uint256 before = usdc.balanceOf(users.investor);
        vm.expectRevert(IRounds.AlreadyPaid.selector);
        vm.prank(users.investor);
        rounds.pay(id);
        assertEq(usdc.balanceOf(users.investor), before, "paid once");
        assertEq(_token(SERIES_C).balanceOf(users.investor), SHARES, "issued once");
    }

    function test_WhenThePayByDateHasPassed() external {
        // it should revert with PayByPassed
        uint256 id = _defaultAllocated();
        _allocated(id, angel, 1000);
        uint64 payBy = rounds.pricedRound(id).payBy;
        vm.warp(payBy);
        _pay(id, angel); // the last second
        vm.warp(payBy + 1);
        uint256 before = usdc.balanceOf(users.investor);
        vm.expectRevert(abi.encodeWithSelector(IRounds.PayByPassed.selector, payBy));
        vm.prank(users.investor);
        rounds.pay(id);
        assertEq(usdc.balanceOf(users.investor), before, "no money moved");
        assertEq(_token(SERIES_C).balanceOf(users.investor), 0, "nothing issued (R3)");
    }

    function test_WhenTheRoundIsClosed() external {
        // it should revert with RoundIsClosed
        uint256 id = _defaultAllocated();
        vm.warp(rounds.pricedRound(id).payBy + 1);
        _close(id, 24_000_000);
        vm.expectRevert(IRounds.RoundIsClosed.selector);
        vm.prank(users.investor);
        rounds.pay(id);
        assertEq(_token(SERIES_C).balanceOf(users.investor), 0, "nothing issued (R3)");
    }

    function test_WhenTheRoundIsCancelled() external {
        // it should revert with RoundIsCancelled
        uint256 id = _defaultAllocated();
        vm.prank(address(safe));
        rounds.cancel(id);
        _expectNoPaymentOrIssue();
        vm.expectRevert(IRounds.RoundIsCancelled.selector);
        vm.prank(users.investor);
        rounds.pay(id);
    }

    modifier whenTheAllocatedInvestorPaysInTime() {
        _;
    }

    function test_WhenTheAllocatedInvestorPaysInTime() external whenTheAllocatedInvestorPaysInTime {
        // it should pull exactly the allocated shares times the price from the investor
        // it should pay exactly that amount to the Safe through Payments with kind 5
        // it should issue exactly the allocated shares to the investor in the same call
        // it should never round the amount or the shares
        // it should hold no balance afterwards
        // it should emit Paid with the shares and the amount and the payment id
        uint256 id = _defaultAllocated();
        uint256 investorBefore = usdc.balanceOf(users.investor);
        uint256 safeBefore = usdc.balanceOf(address(safe));
        assertEq(AMOUNT, 9_489_600 * USDC_UNIT, "4,000,000 x $2.3724");

        // One send per pay: this one, and the unrounded one below.
        vm.expectCall(address(payments), abi.encodeWithSelector(IPayments.send.selector), 2);
        vm.expectEmit(false, true, true, true, address(payments));
        emit IPayments.PaymentSent(
            bytes32(0), address(rounds), address(safe), address(usdc), AMOUNT, KIND_SHARE_PURCHASE, ROUND_DOC
        );
        vm.recordLogs();
        bytes32 returned = _pay(id, users.investor);

        // Same call: the money and the shares both moved by the time `pay` returned (R2).
        assertEq(investorBefore - usdc.balanceOf(users.investor), AMOUNT, "pulled exactly shares x price");
        assertEq(usdc.balanceOf(address(safe)) - safeBefore, AMOUNT, "paid exactly to the Safe");
        assertEq(_token(SERIES_C).balanceOf(users.investor), SHARES, "exactly the allocated shares");
        assertEq(captable.issued(SERIES_C), SHARES, "issued through the Captable");
        assertEq(captable.issuerAllowance(address(rounds), SERIES_C), 0, "the issuer allowance is spent");
        _assertHoldsNothing();
        assertTrue(rounds.position(id, users.investor).paid, "paid");
        assertEq(rounds.pricedRound(id).issuedShares, SHARES, "round issued");

        Vm.Log memory log = _oneLog(IRounds.Paid.selector);
        assertEq(uint256(log.topics[1]), id, "event round");
        assertEq(address(uint160(uint256(log.topics[2]))), users.investor, "event investor");
        (uint128 shares, uint256 amount, bytes32 paymentId) = abi.decode(log.data, (uint128, uint256, bytes32));
        assertEq(shares, SHARES, "event shares");
        assertEq(amount, AMOUNT, "event amount");
        assertEq(paymentId, returned, "event payment id is the returned one");
        assertTrue(paymentId != bytes32(0) && payments.paid(paymentId), "a consumed payment");

        // Never rounds: 3 shares at $0.333333 is exactly $0.999999, not $1.
        uint256 rid = _createPricedRound(SERIES_C, 333_333, 3);
        _allocated(rid, fund, 3);
        uint256 fundBefore = usdc.balanceOf(fund);
        _pay(rid, fund);
        assertEq(fundBefore - usdc.balanceOf(fund), 999_999, "3 x 333,333, unrounded");
        assertEq(_token(SERIES_C).balanceOf(fund), 3, "3 shares");
        _assertHoldsNothing();
    }

    function test_GivenTheSharesAndThePriceAreBothTheLargestUint128() external whenTheAllocatedInvestorPaysInTime {
        // it should compute the amount without overflow
        uint128 max = type(uint128).max;
        uint256 amount = uint256(max) * max;
        MockERC20 big = new MockERC20("Big", "BIG", 6);
        uint8 classId = captable.createClass("Big", max, 0, 0, address(0));
        vm.prank(address(safe));
        uint256 id = rounds.createPricedRound(classId, address(big), max, max, _now() + PAY_WINDOW, ROUND_DOC);
        _invite(id, users.investor, max);
        _commit(id, users.investor, max);
        _allocate(id, users.investor, max);
        big.mint(users.investor, amount);
        vm.prank(users.investor);
        big.approve(address(rounds), type(uint256).max);

        _pay(id, users.investor);
        assertEq(big.balanceOf(users.investor), 0, "pulled (2^128 - 1)^2");
        assertEq(big.balanceOf(address(safe)), amount, "paid (2^128 - 1)^2 to the Safe");
        assertEq(_token(classId).balanceOf(users.investor), max, "issued 2^128 - 1");
        assertEq(big.balanceOf(address(rounds)), 0, "holds nothing");
    }

    function test_WhenAProposalIsPendingInTheRoundsClass() external whenTheAllocatedInvestorPaysInTime {
        // it should revert with ProposalPending and move no money
        uint256 id = _defaultAllocated();
        uint48 until = uint48(_now() + 1 days);
        captable.setPendingUntil(SERIES_C, until);
        uint256 investorBefore = usdc.balanceOf(users.investor);
        uint256 safeBefore = usdc.balanceOf(address(safe));
        vm.expectRevert(abi.encodeWithSelector(ICaptable.ProposalPending.selector, SERIES_C, until));
        vm.prank(users.investor);
        rounds.pay(id);
        assertEq(usdc.balanceOf(users.investor), investorBefore, "no money from the investor");
        assertEq(usdc.balanceOf(address(safe)), safeBefore, "no money to the Safe");
        assertFalse(rounds.position(id, users.investor).paid, "not paid");
        assertEq(rounds.pricedRound(id).issuedShares, 0, "nothing issued");

        // The investor pays again after the snapshot (spec/rounds.md "Paying during a vote").
        vm.warp(until + 1);
        _pay(id, users.investor);
        assertEq(_token(SERIES_C).balanceOf(users.investor), SHARES, "paid after the snapshot");
    }

    function test_WhenTheCaptableRefusesTheIssueForAnotherReason() external whenTheAllocatedInvestorPaysInTime {
        // it should revert and move no money
        uint256 id = _createPricedRound(SERIES_C, PRICE, MAX_SHARES);
        _invite(id, users.investor, INVITED);
        _commit(id, users.investor, INVITED);
        vm.prank(address(safe));
        rounds.allocate(id, users.investor, SHARES); // the Board forgot the issuer allowance
        uint256 investorBefore = usdc.balanceOf(users.investor);
        uint256 safeBefore = usdc.balanceOf(address(safe));
        vm.expectRevert(
            abi.encodeWithSelector(
                ICaptable.IssuerAllowanceExceeded.selector, address(rounds), SERIES_C, uint128(0), SHARES
            )
        );
        vm.prank(users.investor);
        rounds.pay(id);

        // The Captable closed for an exit.
        vm.prank(address(safe));
        captable.setIssuerAllowance(address(rounds), SERIES_C, SHARES);
        captable.setClosedForExit(true);
        vm.expectRevert(ICaptable.CaptableClosed.selector);
        vm.prank(users.investor);
        rounds.pay(id);

        assertEq(usdc.balanceOf(users.investor), investorBefore, "no money from the investor");
        assertEq(usdc.balanceOf(address(safe)), safeBefore, "no money to the Safe");
        assertFalse(rounds.position(id, users.investor).paid, "not paid");
        _assertHoldsNothing();
    }
}
