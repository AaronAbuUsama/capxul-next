// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Vm } from "forge-std/Vm.sol";

import { IAgreements } from "../../../../../src/interfaces/IAgreements.sol";
import { IBudgets } from "../../../../../src/interfaces/IBudgets.sol";
import { Agreements_Unit_Shared } from "../../../../utils/Agreements/Agreements_Unit_Shared.sol";

/// @notice spec/agreements.md `settle` (new in v4: beta `_settleDepartment`,
/// `PayrollDepartments.sol:543-563`, on demand, so a D8 cut can follow an ended agreement); invariant
/// A2. Ports beta `PayrollDepartments.fork.t.sol:431`, `:447` (an expired or withdrawn offer frees its
/// budget).
contract Settle_Agreements_Unit_Concrete_Test is Agreements_Unit_Shared {
    uint64 internal t0;

    function test_WhenACallIntoAgreementsIsAlreadyRunning() external {
        uint256 id = _running();
        vm.prank(users.jordan);
        agreements.end(id, _now() + 1 hours);
        // The helper warps a day, so Alice's end has passed when the token re-enters settle.
        // it should revert with ReentrantCall
        _assertReentryRefused(abi.encodeCall(IAgreements.settle, (operations)));
        assertEq(budgets.ownCommitted(operations), 60_000e6, "the re-entered settle freed nothing");
    }

    function test_WhenTheBudgetHasNoOpenAgreements() external {
        vm.recordLogs();
        // it should do nothing
        vm.prank(users.eve);
        agreements.settle(monthlyBudget);
        assertEq(vm.getRecordedLogs().length, 0, "no event");
        assertEq(budgets.ownCommitted(monthlyBudget), 0, "nothing committed");
        assertEq(agreements.openOf(monthlyBudget).length, 0, "nothing open");
        assertEq(budgets.releaseCalls(), 0, "nothing released");
    }

    modifier whenTheBudgetHasOpenAgreements() {
        t0 = _now();
        _;
    }

    function test_WhenTheBudgetHasOpenAgreements() external whenTheBudgetHasOpenAgreements {
        uint256 ended = _running(); // Alice, 60,000 reserved
        uint256 lapsed = _offerTo(users.bob, 1000e6, MONTH, 0, 0, MONTHLY); // 12,000 reserved
        uint256 running = _stream(); // Alice again, 53,000 reserved, nothing due
        vm.prank(users.jordan);
        agreements.end(ended, t0 + 3 days);
        // The monthly budget has a due agreement too; settling Operations must not touch it.
        vm.prank(users.jordan);
        uint256 elsewhere = agreements.offer(monthlyBudget, users.bob, 1000e6, MONTH, 0, 0, MONTHLY, t0 + 1 days, TERMS);
        vm.warp(t0 + 10 days);
        assertEq(budgets.ownCommitted(operations), 125_000e6, "all three still committed");

        // it should let a lower setAmount that was refused with AmountBelowUse now succeed
        vm.expectRevert(abi.encodeWithSelector(IBudgets.AmountBelowUse.selector, operations, 125_000e6, 100_000e6));
        budgets.setAmount(operations, 100_000e6);

        uint256 safeBefore = usdc.balanceOf(address(safe));
        uint256 aliceBefore = usdc.balanceOf(users.alice);
        vm.recordLogs();
        // it should let anyone call it
        vm.prank(users.eve);
        agreements.settle(operations);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        // it should emit ReservationReleased for each release
        assertEq(_releasedIn(logs, ended), 60_000e6, "the ended agreement's reservation");
        assertEq(_releasedIn(logs, lapsed), 12_000e6, "the lapsed offer's reservation");
        assertEq(_releasedIn(logs, running), 0, "nothing for the running one");
        assertEq(budgets.ownCommitted(operations), 53_000e6, "only the running agreement is committed");
        budgets.setAmount(operations, 100_000e6);

        // it should move no money
        assertEq(usdc.balanceOf(address(safe)), safeBefore, "the Safe paid nothing");
        assertEq(usdc.balanceOf(users.alice), aliceBefore, "Alice received nothing");
        assertEq(budgets.payCount(), 0, "no payout");

        // it should only settle the named budget
        assertEq(budgets.ownCommitted(monthlyBudget), 1000e6, "the monthly budget is unsettled");
        assertEq(agreements.openOf(monthlyBudget).length, 1, "still listed there");
        assertFalse(agreements.agreementOf(elsewhere).closed, "not closed in storage yet");
    }

    function test_GivenAnAgreementsEndHasPassed() external whenTheBudgetHasOpenAgreements {
        uint256 id = _running();
        vm.prank(users.jordan);
        agreements.end(id, t0 + 10 days);
        vm.warp(t0 + 11 days);
        // it should release what is left of its reservation
        vm.expectEmit(address(agreements));
        emit IAgreements.ReservationReleased(address(safe), operations, id, 60_000e6);
        agreements.settle(operations);
        assertEq(budgets.ownCommitted(operations), 0, "freed");
        assertTrue(agreements.agreementOf(id).closed, "closed");
        // it should drop it from the budget's open list
        assertEq(agreements.openOf(operations).length, 0, "dropped");
        // Earned pay stays collectable after the settle.
        assertEq(agreements.availableOf(id), _units(SALARY, MONTH, t0, t0 + 10 days), "ten days owed");
    }

    function test_GivenAnOfferExpiredUnaccepted() external whenTheBudgetHasOpenAgreements {
        uint256 id = _offer();
        vm.warp(agreements.agreementOf(id).offerExpiresAt);
        // it should release its whole reservation
        vm.expectEmit(address(agreements));
        emit IAgreements.ReservationReleased(address(safe), operations, id, 60_000e6);
        agreements.settle(operations);
        assertEq(budgets.ownCommitted(operations), 0, "freed");
        assertTrue(agreements.agreementOf(id).closed, "closed");
        // it should drop it from the budget's open list
        assertEq(agreements.openOf(operations).length, 0, "dropped");
    }

    function test_GivenARateLoweringsDateHasPassed() external whenTheBudgetHasOpenAgreements {
        uint256 id = _running();
        vm.prank(users.jordan);
        agreements.changeRate(id, 2000e6, t0 + 5 days);
        vm.warp(t0 + 6 days);
        // it should release the difference and keep the agreement open
        vm.expectEmit(address(agreements));
        emit IAgreements.ReservationReleased(address(safe), operations, id, 36_000e6);
        agreements.settle(operations);
        assertEq(budgets.ownCommitted(operations), 24_000e6, "2,000 a month for a year");
        assertEq(agreements.agreementOf(id).reserved, 24_000e6, "the reservation now");
        assertFalse(agreements.agreementOf(id).closed, "open");
        assertEq(agreements.openOf(operations).length, 1, "still listed");
        // A second settle releases nothing more.
        vm.recordLogs();
        agreements.settle(operations);
        assertEq(_releasedIn(vm.getRecordedLogs(), id), 0, "released once");
        assertEq(budgets.ownCommitted(operations), 24_000e6, "unchanged");
    }

    function test_GivenAnAgreementIsStillRunningWithNothingDue() external whenTheBudgetHasOpenAgreements {
        uint256 id = _running();
        vm.prank(users.jordan);
        agreements.changeRate(id, 2000e6, t0 + 60 days);
        vm.warp(t0 + 20 days);
        bytes32 before = keccak256(abi.encode(agreements.agreementOf(id)));
        // it should change nothing for it
        agreements.settle(operations);
        assertEq(keccak256(abi.encode(agreements.agreementOf(id))), before, "stored agreement unchanged");
        assertEq(budgets.ownCommitted(operations), 60_000e6, "reservation unchanged");
        assertEq(agreements.openOf(operations).length, 1, "still listed");
    }
}
