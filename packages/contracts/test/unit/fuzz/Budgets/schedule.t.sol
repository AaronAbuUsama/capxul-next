// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IBudgets } from "../../../../src/interfaces/IBudgets.sol";

import { Budgets_Shared_Test } from "../../../utils/Budgets/Budgets_Shared_Test.sol";

/// @notice schedule.tree over its input ranges: any pay date either side of now, any amount against
/// what is left, every kind (M4, F2, B15).
contract Schedule_Budgets_Unit_Fuzz_Test is Budgets_Shared_Test {
    function testFuzz_ReservesIffFutureAndWithinLeft(uint128 amount, uint64 payAt, uint16 kind) external {
        _tree();
        kind = uint16(bound(kind, 0, 3));
        amount = uint128(bound(amount, 1, type(uint128).max));
        vm.prank(users.jordan);
        if (payAt <= block.timestamp) {
            vm.expectRevert(IBudgets.InvalidPayAt.selector);
            budgets.schedule(offsite, users.bob, amount, kind, payAt, DOC, _nextJob());
        } else if (amount > OFFSITE_AMOUNT) {
            vm.expectRevert(abi.encodeWithSelector(IBudgets.OverBudget.selector, offsite, OFFSITE_AMOUNT, amount));
            budgets.schedule(offsite, users.bob, amount, kind, payAt, DOC, _nextJob());
        } else {
            uint256 sid = budgets.schedule(offsite, users.bob, amount, kind, payAt, DOC, _nextJob());
            IBudgets.Scheduled memory s = _scheduled(sid);
            assertEq(s.amount, amount, "amount");
            assertEq(s.payAt, payAt, "payAt");
            assertEq(s.kind, kind, "kind");
            assertEq(_budget(offsite).ownCommitted, amount, "reserved now (B15)");
            assertEq(_budget(top).committed, amount, "committed up the tree");
        }
    }

    function testFuzz_RefusesEveryKindAbove3(uint16 kind) external {
        _tree();
        kind = uint16(bound(kind, 4, type(uint16).max));
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.InvalidKind.selector, kind));
        budgets.schedule(offsite, users.bob, 1, kind, uint64(block.timestamp + 1), DOC, _nextJob());
    }
}
