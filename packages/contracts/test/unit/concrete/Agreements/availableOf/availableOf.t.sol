// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IAgreements } from "../../../../../src/interfaces/IAgreements.sol";
import { CalendarModel } from "../../../../utils/Agreements/CalendarModel.sol";
import { Agreements_Unit_Shared } from "../../../../utils/Agreements/Agreements_Unit_Shared.sol";

/// @notice spec/agreements.md `availableOf`; invariants A1, A5. Ports beta
/// `PayrollDepartments.fork.t.sol:272`, `:287` (release limits collection) and `:342` (an end releases
/// all earned pay, a part step included).
contract AvailableOf_Agreements_Unit_Concrete_Test is Agreements_Unit_Shared {
    uint256 internal id;

    function test_WhenAPendingRateChangeIsDue() external {
        // it should project earnings at both rates without changing state
        id = _running();
        uint64 start = _now();
        vm.prank(users.jordan);
        agreements.changeRate(id, 3000e6, start + 10 days);
        vm.warp(start + 15 days);
        uint256 scaled = CalendarModel.pay(SALARY, MONTH, start, start + 10 days)
            + CalendarModel.pay(3000e6, MONTH, start + 10 days, start + 15 days);
        assertEq(agreements.earnedOf(id), scaled / SCALE, "earnings use each rate");
        assertEq(agreements.availableOf(id), 0, "the first monthly release is not due");
        assertEq(agreements.agreementOf(id).pendingAt, start + 10 days, "view does not apply change");
    }

    function test_WhenAPendingRateChangeIsDueDuringAPause() external {
        // it should not accrue pay during the pause
        id = _running();
        uint64 start = _now();
        vm.prank(users.jordan);
        agreements.changeRate(id, 3000e6, start + 10 days);
        vm.warp(start + 2 days);
        vm.prank(users.jordan);
        agreements.pause(id);
        uint128 earned = agreements.earnedOf(id);
        vm.warp(start + 15 days);
        assertEq(agreements.earnedOf(id), earned, "pause continues across pending change");
        assertEq(agreements.availableOf(id), 0, "the pause does not advance the monthly release");
    }

    function test_WhenTheRateChangeIsDueBeforeTheAgreementStarts() external {
        // it should project the new rate from the start date
        uint64 start = _now() + 30 days;
        id = _offerTo(users.alice, SALARY, MONTH, start, 0, MONTHLY);
        _accept(id);
        vm.prank(users.jordan);
        agreements.changeRate(id, 3000e6, _now() + 10 days);
        vm.warp(start + 5 days);
        assertEq(
            agreements.earnedOf(id),
            CalendarModel.pay(3000e6, MONTH, start, start + 5 days) / SCALE,
            "new rate applies from start"
        );
        assertEq(
            agreements.availableOf(id),
            CalendarModel.units(3000e6, MONTH, start, CalendarModel.monthStart(_now())),
            "the first month boundary releases the part month after the future start"
        );
    }

    function test_WhenTheAgreementIsNotAccepted() external {
        id = _offer();
        vm.warp(_now() + 3 days);
        // it should return 0
        assertEq(agreements.availableOf(id), 0, "an offer has nothing to collect");
        assertEq(agreements.earnedOf(id), 0, "and has earned nothing");
    }

    function test_WhenItIsPaused() external {
        id = _stream();
        uint64 t0 = _now();
        vm.warp(t0 + 2 days);
        vm.prank(users.jordan);
        agreements.pause(id);
        vm.warp(t0 + 9 days);
        // it should return what was released before the pause and not collected
        uint128 before = _units(1000e6, WEEK, t0, t0 + 2 days);
        assertEq(agreements.availableOf(id), before, "the two days before the pause");
        vm.prank(users.alice);
        agreements.collect(id, 100e6);
        assertEq(agreements.availableOf(id), before - 100e6, "less what was collected");
    }

    function test_WhenItHasEnded() external {
        id = _running(); // released monthly, accepted on 1 January
        uint64 t0 = _now();
        vm.prank(users.jordan);
        agreements.end(id, _date(2026, 1, 11));
        vm.warp(_date(2026, 3, 1));
        // it should return everything earned up to the end and not collected
        uint128 earned = _units(SALARY, MONTH, t0, _date(2026, 1, 11));
        assertEq(agreements.availableOf(id), earned, "the part month to the end is released");
        assertEq(agreements.earnedOf(id), earned, "nothing after the end");
    }

    function test_WhenItIsRunning() external {
        id = _running(); // released monthly, accepted on 1 January
        vm.warp(_date(2026, 2, 10));
        // it should return released pay minus collected as of now
        assertEq(agreements.availableOf(id), SALARY, "January is released on 1 February");
        assertGt(agreements.earnedOf(id), SALARY, "February's days are earned, not released");
        // it should equal what collect would allow now
        vm.prank(users.alice);
        vm.expectRevert(abi.encodeWithSelector(IAgreements.InsufficientReleased.selector, SALARY, SALARY + 1));
        agreements.collect(id, SALARY + 1);
        vm.prank(users.alice);
        agreements.collect(id, SALARY);
        assertEq(agreements.availableOf(id), 0, "all collected");
    }
}
