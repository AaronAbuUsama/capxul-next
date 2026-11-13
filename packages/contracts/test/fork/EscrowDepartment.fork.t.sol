// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IEscrow } from "../../src/interfaces/IEscrow.sol";
import { EscrowFactory } from "../../src/money/EscrowFactory.sol";
import { Payments } from "../../src/money/Payments.sol";

import { BudgetsFork_Test } from "./BudgetsFork_Test.t.sol";

/// @notice A department's claim escrow on the real stack (docs/design/escrow.md G9, G10): Operations' wearer pays a
/// mailbox with no account through `Budgets.spend` to the escrow's predicted address, and the escrow names v4 Budgets
/// as its authority with Operations' id as the key. Real Hats decides who may take it back, at the call: the wearer,
/// a wearer above, or the company Safe. Taking it back returns the money to the company Safe and leaves every budget's
/// spent and `leftOf` as they were (Aaron's open question 1: the period's room is not restored).
contract EscrowDepartment_Fork_Test is BudgetsFork_Test {
    uint256 internal constant AMOUNT = 4000e6;
    bytes32 internal constant JOB = keccak256("department job 1");

    EscrowFactory internal factory;
    address internal companiesHouse;
    address internal mailboxSafe; // the counterfactual Safe of a mailbox with no account

    function setUp() public override {
        super.setUp();
        companiesHouse = makeAddr("companies house");
        mailboxSafe = makeAddr("mailbox safe");
        factory = new EscrowFactory(address(new Payments()), companiesHouse);
        _install();
    }

    function _terms() internal view returns (IEscrow.Terms memory) {
        return IEscrow.Terms({
            owner: mailboxSafe,
            sender: address(companySafe),
            authority: address(budgets),
            authorityKey: operations,
            bootstrapOwner: factory.bootstrapOwner(),
            token: address(usdc),
            amount: AMOUNT,
            jobNonce: JOB,
            kind: 0,
            documentHash: DOC,
            condition: 1,
            ownerTakesSurplus: false
        });
    }

    /// @dev Jordan's spend funds the predicted address before the escrow exists; anyone deploys it after (G2).
    function _fundedEscrow() internal returns (IEscrow escrow) {
        address predicted = factory.predictAddress(_terms(), JOB);
        vm.prank(users.jordan);
        budgets.spend(operations, predicted, uint128(AMOUNT), 0, DOC, JOB);
        assertEq(usdc.balanceOf(predicted), AMOUNT, "funded before it exists");
        vm.prank(users.eve);
        escrow = IEscrow(factory.deploy(_terms(), JOB));
        assertEq(address(escrow), predicted, "deployed where the money went");
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT, "deploying moved nothing");
    }

    function test_G9_TheEscrowFollowsTheHatAtTheCall() external {
        IEscrow escrow = _fundedEscrow();
        assertTrue(escrow.canRefund(users.jordan), "Operations' wearer");
        assertTrue(escrow.canRefund(shareholders), "the wearer of the hat above (the top budget's)");
        assertTrue(escrow.canRefund(address(companySafe)), "the company Safe");
        assertFalse(escrow.canRefund(users.ben), "Ben wears nothing yet");
        assertFalse(escrow.canRefund(mailboxSafe), "the owner cannot take it back");
        vm.prank(users.ben);
        vm.expectRevert(abi.encodeWithSelector(IEscrow.CannotRefund.selector, users.ben));
        escrow.refund();

        // Jordan leaves Operations and Ben joins it: Hats changes, nothing about the escrow or Budgets is written.
        vm.prank(noModule);
        HATS.setHatWearerStatus(opsHat, users.jordan, false, true);
        vm.prank(shareholders);
        HATS.mintHat(opsHat, users.ben);
        assertFalse(HATS.isWearerOfHat(users.jordan, opsHat), "Jordan is out");

        assertFalse(escrow.canRefund(users.jordan), "the old holder is refused at once");
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IEscrow.CannotRefund.selector, users.jordan));
        escrow.refund();

        uint256 safeBefore = usdc.balanceOf(address(companySafe));
        uint256 benBefore = usdc.balanceOf(users.ben);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit IEscrow.EscrowRefunded(address(companySafe), users.ben, escrow.paymentId(), AMOUNT, IEscrow.State.Refunded);
        vm.prank(users.ben);
        escrow.refund();
        assertEq(usdc.balanceOf(address(companySafe)), safeBefore + AMOUNT, "the money is back in the company Safe");
        assertEq(usdc.balanceOf(users.ben), benBefore, "not with the one who took it back");
        assertEq(uint256(escrow.state()), uint256(IEscrow.State.Refunded), "refunded");
    }

    function test_G10_ATakeBackLeavesEveryBudgetAsItWas() external {
        uint128 opsBefore = budgets.leftOf(operations);
        uint128 topSpentBefore = budgets.budgetOf(top).spent;
        IEscrow escrow = _fundedEscrow();
        uint128 opsLeft = budgets.leftOf(operations);
        uint128 topLeft = budgets.leftOf(top);
        uint128 ownSpent = budgets.budgetOf(operations).ownSpent;
        uint128 topSpent = budgets.budgetOf(top).spent;
        assertEq(opsLeft, opsBefore - AMOUNT, "the spend counted against Operations");
        assertEq(topSpent, topSpentBefore + AMOUNT, "and rolled up into the top budget's spent");

        vm.prank(users.jordan);
        escrow.refund();

        assertEq(budgets.leftOf(operations), opsLeft, "Operations' room is not restored");
        assertEq(budgets.budgetOf(operations).ownSpent, ownSpent, "Operations' spent unchanged");
        assertEq(budgets.leftOf(top), topLeft, "the top budget's room unchanged");
        assertEq(budgets.budgetOf(top).spent, topSpent, "the top budget's spent unchanged");
        assertEq(usdc.balanceOf(address(escrow)), 0, "empty");
    }

    function test_G4_G7_TheOwnerCannotCollectAfterTheTakeBack() external {
        IEscrow escrow = _fundedEscrow();
        vm.prank(users.jordan);
        escrow.refund();
        vm.prank(mailboxSafe);
        vm.expectRevert(IEscrow.JobNotOpen.selector);
        escrow.collect();
    }
}
