// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IBudgets } from "../../../../../src/interfaces/IBudgets.sol";
import { IPayments } from "../../../../../src/interfaces/IPayments.sol";

import { Budgets_Shared_Test } from "../../../../utils/Budgets/Budgets_Shared_Test.sol";

/// @notice spec/budgets.md `payReserved` (Agreements only, kind 4; B9, D10). The payout batch is
/// beta `PayrollDepartments.collect`'s (`PayrollDepartments.sol:419-438`).
contract PayReserved_Budgets_Unit_Concrete_Test is Budgets_Shared_Test {
    uint128 internal constant RESERVED = 10_000e6;
    uint128 internal constant PAY = 4000e6;
    bytes32 internal constant COLLECTION_JOB = keccak256("agreement 7, collection 3");

    function test_WhenACallIntoBudgetsIsAlreadyRunning() external {
        // it should revert with ReentrantCall
        _assertLockRefuses(abi.encodeCall(IBudgets.payReserved, (1, users.eve, 1, DOC, COLLECTION_JOB)));
    }

    function test_WhenTheCallerIsNotTheAgreementsContract() external {
        _tree();
        _commit(offsite, RESERVED);
        // it should revert with OnlyAgreements
        address[3] memory callers = [users.eve, address(safe), users.jordan];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(IBudgets.OnlyAgreements.selector);
            budgets.payReserved(offsite, callers[i], PAY, DOC, COLLECTION_JOB);
        }
    }

    modifier whenTheCallerIsTheAgreementsContract() {
        _tree();
        _commit(offsite, RESERVED);
        _;
    }

    function test_WhenTheBudgetDoesNotExist() external whenTheCallerIsTheAgreementsContract {
        // it should revert with UnknownBudget
        vm.prank(agreements);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.UnknownBudget.selector, uint256(999)));
        budgets.payReserved(999, users.alice, PAY, DOC, COLLECTION_JOB);
    }

    modifier whenTheBudgetExists() {
        _;
    }

    function test_WhenTheBudgetExists() external whenTheCallerIsTheAgreementsContract whenTheBudgetExists {
        IPayments.PaymentItem memory item = _item(users.alice, address(usdc), PAY, 4, DOC, COLLECTION_JOB);
        uint256 aliceBefore = usdc.balanceOf(users.alice);
        IBudgets.Budget memory before = _budget(offsite);

        // it should pay through the payout role with kind 4
        _expectPayout(item);
        // it should emit ReservedPaid
        vm.expectEmit(true, true, true, true, address(budgets));
        emit IBudgets.ReservedPaid(address(safe), offsite, users.alice, PAY, item.paymentId);
        vm.prank(agreements);
        bytes32 paymentId = budgets.payReserved(offsite, users.alice, PAY, DOC, COLLECTION_JOB);

        // it should return the payment id
        assertEq(paymentId, item.paymentId, "payment id");
        assertTrue(payments.paid(paymentId), "consumed");
        assertEq(usdc.balanceOf(users.alice), aliceBefore + PAY, "Alice paid");
        // it should not change ownSpent or spent
        IBudgets.Budget memory afterPay = _budget(offsite);
        assertEq(afterPay.ownSpent, before.ownSpent, "ownSpent unchanged");
        assertEq(afterPay.spent, before.spent, "spent unchanged");
        assertEq(afterPay.ownCommitted, before.ownCommitted, "the reservation is Agreements' to release");
        assertEq(_budget(top).spent, 0, "nothing up the tree");
    }

    function test_GivenTheBudgetIsClosed() external whenTheCallerIsTheAgreementsContract whenTheBudgetExists {
        _close(address(safe), operating);
        _close(users.jordan, offsite);
        // it should still pay
        uint256 aliceBefore = usdc.balanceOf(users.alice);
        vm.prank(agreements);
        budgets.payReserved(offsite, users.alice, PAY, DOC, COLLECTION_JOB);
        assertEq(usdc.balanceOf(users.alice), aliceBefore + PAY, "paid while closed (B9)");
    }

    function test_WhenRolesOrTheTokenRefusesThePayout()
        external
        whenTheCallerIsTheAgreementsContract
        whenTheBudgetExists
    {
        // it should revert whole
        payoutRoles.setRefuseAll(true);
        vm.prank(agreements);
        vm.expectRevert();
        budgets.payReserved(offsite, users.alice, PAY, DOC, COLLECTION_JOB);
        payoutRoles.setRefuseAll(false);

        usdc.burn(address(safe), usdc.balanceOf(address(safe)));
        vm.prank(agreements);
        vm.expectRevert();
        budgets.payReserved(offsite, users.alice, PAY, DOC, COLLECTION_JOB);
        assertEq(payments.sends(), 0, "nothing paid");

        // The same collection then goes through: nothing was consumed.
        usdc.mint(address(safe), PAY);
        vm.prank(agreements);
        budgets.payReserved(offsite, users.alice, PAY, DOC, COLLECTION_JOB);
        assertEq(payments.sends(), 1, "paid once funded");
    }

    function test_WhenTheTokenRe_entersBudgetsDuringThePayout()
        external
        whenTheCallerIsTheAgreementsContract
        whenTheBudgetExists
    {
        uint256 r = _reentrantBudget();
        _commit(r, 1000e6);
        reentrantToken.arm(
            address(budgets), abi.encodeCall(IBudgets.payReserved, (r, users.eve, 500e6, DOC, keccak256("eve")))
        );
        uint256 eveBefore = reentrantToken.balanceOf(users.eve);
        vm.prank(agreements);
        budgets.payReserved(r, users.alice, 100e6, DOC, COLLECTION_JOB);
        // it should revert the inner call with ReentrantCall
        _assertReentryWasRefused();
        assertEq(reentrantToken.balanceOf(users.eve), eveBefore, "the inner payout paid nothing");
    }
}
