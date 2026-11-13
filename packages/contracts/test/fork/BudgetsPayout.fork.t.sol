// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IBudgets } from "../../src/interfaces/IBudgets.sol";
import { IPayments } from "../../src/interfaces/IPayments.sol";

import { BudgetsFork_Test, IRolesExtra } from "./BudgetsFork_Test.t.sol";

/// @notice Budgets' payout on the real stack (spec/budgets.md "Paying"; invariants B5 and B8): Budgets ->
/// Roles 2.1 (a module on Hats Signer Gate v2) -> the Gate -> the company Safe 1.4.1 -> MultiSendCallOnly
/// 1.4.1 -> `approve` + `Payments.send`, with Roles' payout role scoped as `payroll-payout-role.ts` scopes
/// it (one token, `approve` to Payments only, `send` in that token within its allowance). Ports beta
/// `PayrollDepartments.fork.t.sol` test_rolesCapsEvenABrokenContract and test_aCollectionSpendsThePayoutAllowance.
contract BudgetsPayout_Fork_Test is BudgetsFork_Test {
    /// @dev (1) B5: a hat wearer's spend travels Budgets -> Roles -> Gate -> Safe and spends the payout
    /// allowance by exactly the amount; a spend Budgets would allow but over the allowance is refused by Roles.
    function test_B5_SpendPaysThroughTheGateAndRolesCapsIt() external {
        _install();
        _assertGateIsOnlyModuleAndGuard();
        uint256 safeBefore = usdc.balanceOf(address(companySafe));
        uint256 aliceBefore = usdc.balanceOf(users.alice);

        vm.prank(users.jordan);
        budgets.spend(operations, users.alice, 4000e6, 0, DOC, keccak256("job 1"));

        assertEq(usdc.balanceOf(users.alice), aliceBefore + 4000e6, "Alice paid");
        assertEq(usdc.balanceOf(address(companySafe)), safeBefore - 4000e6, "the company Safe paid");
        assertEq(usdc.allowance(address(companySafe), address(payments)), 0, "no standing approval");
        (,,, uint128 left,) = IRolesExtra(address(companyRoles)).allowances(PAYOUT_ALLOWANCE);
        assertEq(left, CEILING - 4000e6, "Roles counted the send");

        // Budgets has 246,000 left in Operations, but Roles has 6,000.
        vm.prank(users.jordan);
        vm.expectRevert();
        budgets.spend(operations, users.alice, 6000e6 + 1, 0, DOC, keccak256("job 2"));
        assertEq(budgets.budgetOf(operations).ownSpent, 4000e6, "the refused spend left nothing behind");
        assertEq(usdc.balanceOf(users.alice), aliceBefore + 4000e6, "and paid nothing");
    }

    /// @dev (2) B8: even calling Roles directly as Budgets, the payout role moves money only by `approve`
    /// to Payments and `send` in the enabled token within the allowance.
    function test_B8_PayoutRoleRefusesEverythingElseEvenAsBudgets() external {
        _install();
        vm.startPrank(address(budgets));
        // A plain transfer.
        vm.expectRevert();
        companyRoles.execTransactionWithRole(
            address(usdc),
            0,
            abi.encodeWithSignature("transfer(address,uint256)", users.eve, 1),
            CALL,
            PAYOUT_ROLE,
            true
        );
        // An approval to anyone but Payments.
        vm.expectRevert();
        companyRoles.execTransactionWithRole(
            address(usdc), 0, abi.encodeWithSignature("approve(address,uint256)", users.eve, 1), CALL, PAYOUT_ROLE, true
        );
        // A send in a token the role does not enable.
        IPayments.PaymentItem memory item = _item(address(dai), 1);
        vm.expectRevert();
        companyRoles.execTransactionWithRole(
            address(payments), 0, abi.encodeCall(IPayments.send, (item)), CALL, PAYOUT_ROLE, true
        );
        // A send over the allowance.
        item = _item(address(usdc), CEILING + 1);
        vm.expectRevert();
        companyRoles.execTransactionWithRole(
            address(payments), 0, abi.encodeCall(IPayments.send, (item)), CALL, PAYOUT_ROLE, true
        );
        vm.stopPrank();
        (,,, uint128 left,) = IRolesExtra(address(companyRoles)).allowances(PAYOUT_ALLOWANCE);
        assertEq(left, CEILING, "nothing was counted");
    }

    /// @dev (3) M4 on the real stack: Jordan schedules a supplier payment for the 1st; anyone executes it on
    /// the 1st, once.
    function test_ScheduledPaymentExecutesOnceOnTheFork() external {
        _install();
        uint64 payAt = uint64(block.timestamp + 10 days);
        vm.prank(users.jordan);
        uint256 sid = budgets.schedule(operations, users.bob, 2500e6, 1, payAt, DOC, keccak256("job 3"));
        uint256 bobBefore = usdc.balanceOf(users.bob);

        vm.warp(payAt);
        vm.prank(users.eve);
        budgets.execute(sid);
        assertEq(usdc.balanceOf(users.bob), bobBefore + 2500e6, "Bob paid on the day");

        vm.prank(users.eve);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotPending.selector, sid));
        budgets.execute(sid);
        assertEq(usdc.balanceOf(users.bob), bobBefore + 2500e6, "once");
    }

    /// @dev (4) What a spend sent by the company Safe itself does: the payout is a module call nested in a
    /// Safe transaction, which the Gate refuses (`NoReentryAllowed`, R3 Q4 point 3), so the whole Safe
    /// transaction fails and nothing moves. The Board pays through a hat wearer or a scheduled payment.
    function test_SpendSentByTheSafeItselfIsRefusedByTheGate() external {
        _install();
        uint256 safeBefore = usdc.balanceOf(address(companySafe));
        bytes memory data =
            abi.encodeCall(IBudgets.spend, (operations, users.alice, 1000e6, 0, DOC, keccak256("board job")));
        bytes memory sig = _boardApprove(address(budgets), 0, data, CALL);
        vm.expectRevert();
        companySafe.execTransaction(address(budgets), 0, data, CALL, 0, 0, 0, address(0), payable(address(0)), sig);
        assertEq(usdc.balanceOf(address(companySafe)), safeBefore, "nothing moved");
        assertEq(budgets.budgetOf(operations).ownSpent, 0, "nothing spent");
    }
}
