// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IBudgets } from "../../../../../src/interfaces/IBudgets.sol";

import { Budgets_Shared_Test } from "../../../../utils/Budgets/Budgets_Shared_Test.sol";

/// @notice spec/budgets.md `setAmount` (D8 / B12, B6, H3). Beta allowed a cut below use (R2 PD5);
/// v4 refuses it.
contract SetAmount_Budgets_Unit_Concrete_Test is Budgets_Shared_Test {
    function test_WhenACallIntoBudgetsIsAlreadyRunning() external {
        // it should revert with ReentrantCall
        _assertLockRefuses(abi.encodeCall(IBudgets.setAmount, (1, 1)));
    }

    function test_WhenTheBudgetDoesNotExist() external {
        _tree();
        // it should revert with UnknownBudget
        vm.prank(address(safe));
        vm.expectRevert(abi.encodeWithSelector(IBudgets.UnknownBudget.selector, uint256(999)));
        budgets.setAmount(999, 1);
    }

    function test_WhenTheBudgetIsATopBudgetAndTheCallerIsNotItsSafe() external {
        _tree();
        // it should revert with NotAuthorised
        vm.prank(users.amira);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotAuthorised.selector, top, users.amira));
        budgets.setAmount(top, TOP_AMOUNT + 1);
    }

    function test_WhenTheBudgetIsAChildAndTheCallerIsNotAuthorisedForItsParent() external {
        _tree();
        // it should revert with NotAuthorised
        vm.prank(users.eve);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotAuthorised.selector, offsite, users.eve));
        budgets.setAmount(offsite, 1);
    }

    function test_GivenTheCallerWearsOnlyTheBudgetsOwnHat() external {
        _tree();
        // it should revert with NotAuthorised
        // A wearer never raises their own budget through their own hat alone (H3).
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotAuthorised.selector, operations, users.jordan));
        budgets.setAmount(operations, OPERATIONS_AMOUNT + 1);

        vm.prank(users.amira);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotAuthorised.selector, operating, users.amira));
        budgets.setAmount(operating, OPERATING_AMOUNT + 1);
    }

    modifier whenTheCallerMaySetIt() {
        _tree();
        _;
    }

    function test_WhenTheNewAmountIsBelowOwnSpendPlusOwnCommittedPlusChildrenAmount() external whenTheCallerMaySetIt {
        // Operations uses Offsite 20,000 + spent 10,000 + committed 5,000 = 35,000.
        _spend(users.jordan, operations, 10_000e6);
        _commit(operations, 5000e6);
        uint128 used = 35_000e6;
        assertEq(_used(operations), used, "what Operations uses");
        // it should revert with AmountBelowUse with what the budget uses
        vm.prank(users.amira);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.AmountBelowUse.selector, operations, used, used - 1));
        budgets.setAmount(operations, used - 1);

        // The same holds at the top: the Safe cannot cut below Operating's 500,000.
        vm.prank(address(safe));
        vm.expectRevert(
            abi.encodeWithSelector(IBudgets.AmountBelowUse.selector, top, OPERATING_AMOUNT, OPERATING_AMOUNT - 1)
        );
        budgets.setAmount(top, OPERATING_AMOUNT - 1);
    }

    function test_GivenAPendingScheduledPaymentHoldsPartOfWhatTheBudgetUses() external whenTheCallerMaySetIt {
        uint256 sid = _schedule(users.jordan, offsite, 15_000e6, uint64(block.timestamp + 30 days));
        // it should revert with AmountBelowUse until the payment is cancelled or paid
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.AmountBelowUse.selector, offsite, 15_000e6, 10_000e6));
        budgets.setAmount(offsite, 10_000e6);

        vm.prank(users.jordan);
        budgets.cancel(sid);
        vm.prank(users.jordan);
        budgets.setAmount(offsite, 10_000e6);
        assertEq(_budget(offsite).amount, 10_000e6, "lowered once the payment was cancelled");
    }

    function test_GivenAnEndedAgreementStillHoldsItsReservationUntilSettled() external whenTheCallerMaySetIt {
        // An agreement that ended but has not been settled still holds 15,000.
        _commit(offsite, 15_000e6);
        // it should revert with AmountBelowUse until Agreements settle frees it
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.AmountBelowUse.selector, offsite, 15_000e6, 10_000e6));
        budgets.setAmount(offsite, 10_000e6);

        // Agreements.settle releases the reservation.
        vm.prank(agreements);
        budgets.release(offsite, 15_000e6);
        vm.prank(users.jordan);
        budgets.setAmount(offsite, 10_000e6);
        assertEq(_budget(offsite).amount, 10_000e6, "lowered once settled");
    }

    function test_GivenTheBudgetsPeriodTurnedSinceItWasLastUsed() external whenTheCallerMaySetIt {
        _spend(users.jordan, offsite, 15_000e6);
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.AmountBelowUse.selector, offsite, 15_000e6, 5000e6));
        budgets.setAmount(offsite, 5000e6);

        vm.warp(_timestamp(2027, 1, 1));
        // it should count its own spend as 0
        vm.prank(users.jordan);
        budgets.setAmount(offsite, 5000e6);
        assertEq(_budget(offsite).amount, 5000e6, "lowered in the new year");
        assertEq(_budget(offsite).ownSpent, 0, "own spend reads 0");
    }

    function test_WhenTheBudgetIsAChildAndTheRaiseIsMoreThanTheRoomLeftInTheParent() external whenTheCallerMaySetIt {
        // Operations has 250,000 - 20,000 = 230,000 of room for Offsite to grow into.
        uint128 room = OPERATIONS_AMOUNT - OFFSITE_AMOUNT;
        // it should revert with ChildrenExceedParent
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.ChildrenExceedParent.selector, operations, room, room + 1));
        budgets.setAmount(offsite, OFFSITE_AMOUNT + room + 1);

        // Exactly the room is accepted.
        vm.prank(users.jordan);
        budgets.setAmount(offsite, OFFSITE_AMOUNT + room);
        assertEq(budgets.leftOf(operations), 0, "Operations is full");
    }

    modifier whenTheNewAmountFits() {
        _;
    }

    function test_WhenTheNewAmountFits() external whenTheCallerMaySetIt whenTheNewAmountFits {
        // it should emit BudgetAmountSet
        vm.expectEmit(true, true, true, true, address(budgets));
        emit IBudgets.BudgetAmountSet(address(safe), top, 700_000e6);
        vm.prank(address(safe));
        budgets.setAmount(top, 700_000e6);
        // it should set the amount
        assertEq(_budget(top).amount, 700_000e6, "top raised");
        assertEq(budgets.leftOf(top), 700_000e6 - OPERATING_AMOUNT, "top's left");
    }

    function test_GivenTheBudgetIsAChild() external whenTheCallerMaySetIt whenTheNewAmountFits {
        // it should move the parent's childrenAmount by the difference
        vm.prank(users.amira);
        budgets.setAmount(operations, 300_000e6);
        assertEq(_budget(operating).childrenAmount, 300_000e6, "raised by 50,000");

        vm.prank(users.amira);
        budgets.setAmount(operations, 100_000e6);
        assertEq(_budget(operating).childrenAmount, 100_000e6, "lowered by 200,000");
        assertEq(budgets.leftOf(operating), OPERATING_AMOUNT - 100_000e6, "Operating's room grew");
    }

    function test_GivenTheNewAmountEqualsExactlyWhatTheBudgetUses()
        external
        whenTheCallerMaySetIt
        whenTheNewAmountFits
    {
        _spend(users.jordan, operations, 10_000e6);
        // it should set it and leave nothing to spend
        vm.prank(users.amira);
        budgets.setAmount(operations, 30_000e6);
        assertEq(_budget(operations).amount, 30_000e6, "set to what it uses");
        assertEq(budgets.leftOf(operations), 0, "nothing left");
    }

    function test_GivenTheBudgetIsClosed() external whenTheCallerMaySetIt whenTheNewAmountFits {
        _close(users.amira, operations);
        // it should still set the amount
        vm.prank(users.amira);
        budgets.setAmount(operations, 20_000e6);
        assertEq(_budget(operations).amount, 20_000e6, "lowered while closed, freeing the parent's room");
        assertEq(_budget(operating).childrenAmount, 20_000e6, "parent's room freed");
    }
}
