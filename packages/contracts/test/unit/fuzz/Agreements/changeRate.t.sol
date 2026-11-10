// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IAgreements } from "../../../../src/interfaces/IAgreements.sol";
import { CalendarModel } from "../../../utils/Agreements/CalendarModel.sol";
import { Agreements_Unit_Shared } from "../../../utils/Agreements/Agreements_Unit_Shared.sol";

/// @notice `changeRate` over its rates and dates (A2 in parts).
contract ChangeRate_Agreements_Unit_Fuzz_Test is Agreements_Unit_Shared {
    /// @dev Any raise that fits: the budget commits exactly the difference of the period figures.
    function testFuzz_ARaiseCommitsTheFigureDifference(uint128 newRate, uint8 period) external {
        period = uint8(bound(period, 0, 2));
        uint128 rate = period == WEEK ? 1000e6 : period == MONTH ? SALARY : 60_000e6;
        uint256 id = _offerTo(users.alice, rate, period, 0, 0, 1);
        _accept(id);
        uint128 before = budgets.ownCommitted(operations);
        uint256 room = 250_000e6 - uint256(before);
        newRate = uint128(bound(newRate, rate + 1, rate * 4));
        uint256 diff = CalendarModel.periodFigure(newRate, period, BUDGET_YEAR) - before;
        vm.prank(users.jordan);
        if (diff > room) {
            vm.expectPartialRevert(bytes4(keccak256("OverBudget(uint256,uint128,uint128)")));
            agreements.changeRate(id, newRate, 0);
            return;
        }
        agreements.changeRate(id, newRate, 0);
        assertEq(budgets.ownCommitted(operations), before + diff, "the difference is committed");
        assertEq(agreements.agreementOf(id).reserved, before + diff, "and added to the reservation");
    }

    /// @dev Any lowering, effective up to 90 days out, observed at any later time: before its date nothing is
    /// freed; once due and brought up to date, exactly the figure difference is freed and the agreement stays
    /// open.
    function testFuzz_ALoweringFreesTheFigureDifferenceOnceDue(uint128 newRate, uint32 delay, uint32 wait) external {
        uint256 id = _running();
        newRate = uint128(bound(newRate, 1, SALARY - 1));
        uint64 effectiveAt = _now() + uint64(bound(delay, 0, 90 days));
        vm.prank(users.jordan);
        agreements.changeRate(id, newRate, effectiveAt);
        vm.warp(_now() + bound(wait, 0, 180 days));
        agreements.settle(operations);
        uint256 expected = _now() >= effectiveAt ? uint256(newRate) * 12 : 60_000e6;
        assertEq(budgets.ownCommitted(operations), expected, "freed only once due");
        assertEq(agreements.agreementOf(id).reserved, expected, "the agreement agrees");
        assertFalse(agreements.agreementOf(id).closed, "still open");
    }

    /// @dev An effective date anywhere in the past is refused for a lowering.
    function testFuzz_RevertWhen_ALoweringIsBackdated(uint32 back) external {
        uint256 id = _running();
        vm.warp(_now() + 365 days);
        vm.prank(users.jordan);
        vm.expectRevert(IAgreements.InvalidDate.selector);
        agreements.changeRate(id, 1000e6, _now() - uint64(bound(back, 1, 365 days)));
    }
}
