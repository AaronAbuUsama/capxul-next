// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IBudgets } from "../../../../src/interfaces/IBudgets.sol";

import { Budgets_Shared_Test } from "../../../utils/Budgets/Budgets_Shared_Test.sol";

/// @notice setAmount.tree over every new amount: refused below use (D8, B12), refused above the
/// parent's room, otherwise set with the parent's childrenAmount moved by the difference (B6).
contract SetAmount_Budgets_Unit_Fuzz_Test is Budgets_Shared_Test {
    function testFuzz_SetIffBetweenUseAndRoom(uint128 spent, uint128 scheduled, uint128 amount) external {
        _tree();
        spent = uint128(bound(spent, 0, OFFSITE_AMOUNT));
        scheduled = uint128(bound(scheduled, 0, OFFSITE_AMOUNT - spent));
        if (spent > 0) _spend(users.jordan, offsite, spent);
        if (scheduled > 0) _schedule(users.jordan, offsite, scheduled, uint64(block.timestamp + 1 days));
        uint128 used = spent + scheduled;
        uint128 room = OPERATIONS_AMOUNT - OFFSITE_AMOUNT;

        vm.prank(users.jordan);
        if (amount < used) {
            vm.expectRevert(abi.encodeWithSelector(IBudgets.AmountBelowUse.selector, offsite, used, amount));
            budgets.setAmount(offsite, amount);
        } else if (amount > OFFSITE_AMOUNT && amount - OFFSITE_AMOUNT > room) {
            vm.expectRevert(
                abi.encodeWithSelector(
                    IBudgets.ChildrenExceedParent.selector, operations, room, amount - OFFSITE_AMOUNT
                )
            );
            budgets.setAmount(offsite, amount);
        } else {
            budgets.setAmount(offsite, amount);
            assertEq(_budget(offsite).amount, amount, "amount");
            assertEq(_budget(operations).childrenAmount, amount, "parent's childrenAmount (B6)");
            assertLe(_used(offsite), amount, "B1 on the child");
            assertLe(_used(operations), OPERATIONS_AMOUNT, "B1 on the parent");
        }
    }

    function testFuzz_TopOnlyByTheSafe(address caller, uint128 amount) external {
        _tree();
        vm.assume(caller != address(safe));
        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotAuthorised.selector, top, caller));
        budgets.setAmount(top, amount);
    }
}
