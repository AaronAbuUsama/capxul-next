// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IBudgets } from "../../../../../src/interfaces/IBudgets.sol";

import { Budgets_Shared_Test } from "../../../../utils/Budgets/Budgets_Shared_Test.sol";

/// @notice spec/budgets.md `createChildBudget` (B3, B4, B6, Q16). Ports the shape of Firm
/// `Budget.t.sol` testCreateSuballowance, testCantCreateSuballowanceIfNotSpender and testAllowanceChain.
contract CreateChildBudget_Budgets_Unit_Concrete_Test is Budgets_Shared_Test {
    function test_WhenACallIntoBudgetsIsAlreadyRunning() external {
        // it should revert with ReentrantCall
        _assertLockRefuses(abi.encodeCall(IBudgets.createChildBudget, (1, 1, OPS_HAT)));
    }

    function test_WhenTheParentDoesNotExist() external {
        _tree();
        // it should revert with UnknownBudget
        vm.prank(address(safe));
        vm.expectRevert(abi.encodeWithSelector(IBudgets.UnknownBudget.selector, uint256(999)));
        budgets.createChildBudget(999, 1, OPS_HAT);

        vm.prank(address(safe));
        vm.expectRevert(abi.encodeWithSelector(IBudgets.UnknownBudget.selector, uint256(0)));
        budgets.createChildBudget(0, 1, OPS_HAT);
    }

    /// @dev The startup tree on quarters, so a period turns within the year.
    modifier whenTheParentExists() {
        _tree(QUARTER);
        _;
    }

    function test_WhenTheCallerIsNotAuthorisedForTheParent() external whenTheParentExists {
        // it should revert with NotAuthorised
        vm.prank(users.eve);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotAuthorised.selector, operations, users.eve));
        budgets.createChildBudget(operations, 1, OPS_HAT);

        // Jordan's Ops hat sits below Operating, so it does not reach it.
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotAuthorised.selector, operating, users.jordan));
        budgets.createChildBudget(operating, 1, OPS_HAT);
    }

    modifier whenTheCallerIsAuthorisedForTheParent() {
        _;
    }

    function test_WhenTheParentOrABudgetAboveItIsClosed()
        external
        whenTheParentExists
        whenTheCallerIsAuthorisedForTheParent
    {
        _close(address(safe), top);
        _close(address(safe), operating);
        // it should revert with BudgetIsClosed naming the nearest closed budget
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.BudgetIsClosed.selector, operating));
        budgets.createChildBudget(offsite, 1, OPS_HAT);

        vm.prank(users.amira);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.BudgetIsClosed.selector, operating));
        budgets.createChildBudget(operating, 1, OPS_HAT);
    }

    function test_WhenTheParentIsAtTheMaximumDepthOf8()
        external
        whenTheParentExists
        whenTheCallerIsAuthorisedForTheParent
    {
        // A fresh chain of eight budgets, from the top down.
        uint256 deepest = _chainUnder(top, 7);
        assertEq(_budget(deepest).depth, 8, "the chain reaches depth 8");
        // it should revert with TooDeep
        vm.prank(address(safe));
        vm.expectRevert(IBudgets.TooDeep.selector);
        budgets.createChildBudget(deepest, 1, OPS_HAT);
    }

    function test_WhenTheHatIs0() external whenTheParentExists whenTheCallerIsAuthorisedForTheParent {
        // it should revert with InvalidHat
        vm.prank(users.jordan);
        vm.expectRevert(IBudgets.InvalidHat.selector);
        budgets.createChildBudget(operations, 1, 0);
    }

    function test_WhenTheAmountIsMoreThanTheRoomLeftInTheParent()
        external
        whenTheParentExists
        whenTheCallerIsAuthorisedForTheParent
    {
        // Operations: 250,000 - Offsite 20,000 - spent 10,000 - committed 5,000 = 215,000 of room.
        _spend(users.jordan, operations, 10_000e6);
        _commit(operations, 5000e6);
        uint128 room = 215_000e6;
        // it should revert with ChildrenExceedParent with the parent and the room left
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.ChildrenExceedParent.selector, operations, room, room + 1));
        budgets.createChildBudget(operations, room + 1, SPARE_HAT);
    }

    modifier whenTheAmountFitsTheRoomLeftInTheParent() {
        _;
    }

    function test_WhenTheAmountFitsTheRoomLeftInTheParent()
        external
        whenTheParentExists
        whenTheCallerIsAuthorisedForTheParent
        whenTheAmountFitsTheRoomLeftInTheParent
    {
        uint128 amount = 30_000e6;

        // it should emit BudgetCreated
        vm.expectEmit(true, true, true, true, address(budgets));
        emit IBudgets.BudgetCreated(address(safe), 5, operations, address(usdc), QUARTER, amount, SPARE_HAT);
        uint256 id = _createChild(users.jordan, operations, amount, SPARE_HAT);
        assertEq(id, 5, "the next id");

        IBudgets.Budget memory child = _budget(id);
        // it should give the child the parent's token and period
        assertEq(child.token, address(usdc), "token (B4)");
        assertEq(child.period, QUARTER, "period (B4)");
        assertEq(child.safe, address(safe), "safe");
        assertEq(child.parent, operations, "parent");
        assertEq(child.amount, amount, "amount");
        // it should set the child's depth to the parent's plus one
        assertEq(child.depth, _budget(operations).depth + 1, "depth");
        assertEq(child.depth, 4, "depth 4");
        // it should store the child's hat
        assertEq(child.hat, SPARE_HAT, "hat");
        // it should add the amount to the parent's childrenAmount
        assertEq(_budget(operations).childrenAmount, OFFSITE_AMOUNT + amount, "parent childrenAmount (B6)");
        assertEq(budgets.leftOf(operations), OPERATIONS_AMOUNT - OFFSITE_AMOUNT - amount, "parent's left");
        // it should list the child under the parent
        uint256[] memory children = budgets.childrenOf(operations);
        assertEq(children.length, 2, "two children");
        assertEq(children[0], offsite, "Offsite first");
        assertEq(children[1], id, "the new child");
        uint256[] memory path = budgets.pathOf(id);
        assertEq(path.length, 4, "path length");
        assertEq(path[0], top, "path from the top");
        assertEq(path[3], id, "path ends at the child");
    }

    function test_GivenTheCallerWearsTheHatOfABudgetTwoLevelsAbove()
        external
        whenTheParentExists
        whenTheCallerIsAuthorisedForTheParent
        whenTheAmountFitsTheRoomLeftInTheParent
    {
        // Amira wears CEO (Operating), two levels above Offsite.
        // it should allow it
        uint256 id = _createChild(users.amira, offsite, 1000e6, SPARE_HAT);
        assertEq(_budget(id).parent, offsite, "created under Offsite");
        assertEq(_budget(offsite).childrenAmount, 1000e6, "Offsite's childrenAmount");
    }

    function test_GivenTheParentsPeriodTurnedSinceItWasLastUsed()
        external
        whenTheParentExists
        whenTheCallerIsAuthorisedForTheParent
        whenTheAmountFitsTheRoomLeftInTheParent
    {
        // Operations spends all its room in the first quarter of 2026.
        uint128 room = OPERATIONS_AMOUNT - OFFSITE_AMOUNT;
        _spend(users.jordan, operations, room);
        assertEq(budgets.leftOf(operations), 0, "no room in Q1");

        vm.warp(_timestamp(2026, 4, 1));
        // it should count the parent's room with its own spend at 0
        assertEq(budgets.leftOf(operations), room, "room is back in Q2");
        uint256 id = _createChild(users.jordan, operations, room, SPARE_HAT);
        assertEq(_budget(id).amount, room, "created with the whole room");
        assertEq(_budget(operations).ownSpent, 0, "own spend reads 0");
        assertEq(budgets.leftOf(operations), 0, "room now taken by the child");
    }

    /// @dev `levels` budgets in a line under `parent`, each 1,000 under the one above.
    function _chainUnder(uint256 parent, uint256 levels) internal returns (uint256 id) {
        id = parent;
        uint128 amount = _budget(parent).amount - _budget(parent).childrenAmount;
        for (uint256 i; i < levels; ++i) {
            amount -= 1000e6;
            id = _createChild(address(safe), id, amount, SPARE_HAT);
        }
    }
}
