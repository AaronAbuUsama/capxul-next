// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IBudgets } from "../../../../../src/interfaces/IBudgets.sol";

import { Budgets_Shared_Test } from "../../../../utils/Budgets/Budgets_Shared_Test.sol";

/// @notice spec/budgets.md `setHat` (H3, H6).
contract SetHat_Budgets_Unit_Concrete_Test is Budgets_Shared_Test {
    function test_WhenACallIntoBudgetsIsAlreadyRunning() external {
        // it should revert with ReentrantCall
        _assertLockRefuses(abi.encodeCall(IBudgets.setHat, (1, SPARE_HAT)));
    }

    function test_WhenTheBudgetDoesNotExist() external {
        _tree();
        // it should revert with UnknownBudget
        vm.prank(address(safe));
        vm.expectRevert(abi.encodeWithSelector(IBudgets.UnknownBudget.selector, uint256(999)));
        budgets.setHat(999, SPARE_HAT);
    }

    function test_WhenTheBudgetIsATopBudgetAndTheCallerIsNotItsSafe() external {
        _tree();
        // it should revert with NotAuthorised
        vm.prank(users.amira);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotAuthorised.selector, top, users.amira));
        budgets.setHat(top, SPARE_HAT);
    }

    function test_WhenTheBudgetIsAChildAndTheCallerIsNotAuthorisedForItsParent() external {
        _tree();
        // it should revert with NotAuthorised
        // Jordan wears Operations' own hat, which does not reach its parent (H3).
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotAuthorised.selector, operations, users.jordan));
        budgets.setHat(operations, SPARE_HAT);

        vm.prank(users.eve);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotAuthorised.selector, offsite, users.eve));
        budgets.setHat(offsite, SPARE_HAT);
    }

    function test_WhenTheHatIs0() external {
        _tree();
        // it should revert with InvalidHat
        vm.prank(address(safe));
        vm.expectRevert(IBudgets.InvalidHat.selector);
        budgets.setHat(top, 0);

        vm.prank(users.amira);
        vm.expectRevert(IBudgets.InvalidHat.selector);
        budgets.setHat(operations, 0);
    }

    function test_WhenTheCallerMayManageTheBudgetAndTheHatIsNot0() external {
        _tree();
        uint64 payAt = uint64(block.timestamp + 1 days);
        uint256 sid = _schedule(users.jordan, operations, 1000e6, payAt);
        _commit(operations, 3000e6);
        IBudgets.Budget memory before = _budget(operations);

        // it should emit BudgetHatSet
        vm.expectEmit(true, true, true, true, address(budgets));
        emit IBudgets.BudgetHatSet(address(safe), operations, SPARE_HAT);
        vm.prank(users.amira);
        budgets.setHat(operations, SPARE_HAT);

        // it should replace the hat
        assertEq(_budget(operations).hat, SPARE_HAT, "new hat");

        // it should stop the old hat's wearers acting on the budget
        assertFalse(budgets.authorised(operations, users.jordan), "Jordan is out of Operations");
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotAuthorised.selector, operations, users.jordan));
        budgets.spend(operations, users.alice, 1, 0, DOC, JOB);
        assertTrue(budgets.authorised(offsite, users.jordan), "Offsite still names Ops");

        // it should leave running agreements and pending scheduled payments unchanged
        assertEq(_budget(operations).ownCommitted, before.ownCommitted, "reservations unchanged");
        assertEq(_budget(operations).committed, before.committed, "committed unchanged");
        assertEq(uint8(_scheduled(sid).state), uint8(IBudgets.ScheduleState.Pending), "still pending");
        vm.warp(payAt);
        budgets.execute(sid);
        assertEq(uint8(_scheduled(sid).state), uint8(IBudgets.ScheduleState.Paid), "still pays");
    }
}
