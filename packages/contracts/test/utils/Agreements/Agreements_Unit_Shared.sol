// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Vm } from "forge-std/Vm.sol";

import { Base_Test } from "../../Base.t.sol";
import { Agreements } from "../../../src/money/Agreements.sol";
import { IAgreements } from "../../../src/interfaces/IAgreements.sol";
import { CalendarModel } from "./CalendarModel.sol";
import { MockRoles } from "../../mocks/MockRoles.sol";
import { MockSafe } from "../../mocks/MockSafe.sol";
import { MockBudgets } from "./MockBudgets.sol";

/// @notice The company the Agreements unit and fuzz tests share (spec/agreements.md; startup story M6):
///
/// ```text
/// Company (top) · USDC · 600,000 a year   hat BOARD (worn by no one: only the Safe acts)
/// └── Operating · 500,000 a year          hat CEO (Amira)
///     └── Operations · 250,000 a year     hat OPS (Jordan)    <- most agreements are offered here
/// Monthly · USDC · 20,000 a month          hat OPS (Jordan)    <- a BUDGET_MONTH budget
/// Re-entrant · REENTER · 250,000 a year    hat OPS (Jordan)    <- its token calls back into Agreements
/// Other company (otherSafe) · USDC         hat OTHER (Ben)     <- a second Safe, for B7
/// ```
///
/// Budgets is the `MockBudgets` stand-in (its own contract is tested in W2's Budgets suite); the payout
/// still runs through Base_Test's Roles and Safe mocks, so Roles, the Safe's balance and the token can
/// each refuse a collection.
abstract contract Agreements_Unit_Shared is Base_Test {
    uint256 internal constant BOARD_HAT = TOP_HAT | (uint256(2) << 208);
    uint256 internal constant CEO_HAT = BOARD_HAT | (uint256(1) << 192);
    uint256 internal constant OPS_HAT = CEO_HAT | (uint256(1) << 176);
    uint256 internal constant OTHER_HAT = TOP_HAT | (uint256(3) << 208);
    bytes32 internal constant PAYOUT_KEY = "capxul.payout";
    bytes32 internal constant TERMS = keccak256("Alice's employment terms");

    uint64 internal constant MONTHLY = type(uint64).max;
    uint256 internal constant SCALE = CalendarModel.SCALE;
    uint8 internal constant WEEK = 0;
    uint8 internal constant MONTH = 1;
    uint8 internal constant YEAR = 2;
    uint8 internal constant BUDGET_MONTH = 0;
    uint8 internal constant BUDGET_QUARTER = 1;
    uint8 internal constant BUDGET_YEAR = 2;

    /// @dev 5,000 USDC a month: Alice's salary.
    uint128 internal constant SALARY = 5000e6;

    Agreements internal agreements;
    MockBudgets internal budgets;
    address internal otherSafe;
    MockRoles internal otherRoles;

    uint256 internal companyBudget;
    uint256 internal operating;
    uint256 internal operations;
    uint256 internal monthlyBudget;
    uint256 internal reentrantBudget;
    uint256 internal otherBudget;

    function _deployProtocol() internal virtual override {
        budgets = new MockBudgets(hats);
        agreements = new Agreements(address(budgets));
        budgets.setAgreements(address(agreements));
        vm.label(address(budgets), "Budgets (stand-in)");
        vm.label(address(agreements), "Agreements");

        // Budgets is the payout role's only member; it may move USDC and the re-entrant token.
        roles.setMember(PAYOUT_KEY, address(budgets), true);
        roles.allowTarget(PAYOUT_KEY, address(usdc), true);
        roles.allowTarget(PAYOUT_KEY, address(reentrantToken), true);
        roles.setAllowance(PAYOUT_KEY, address(usdc), type(uint256).max);
        roles.setAllowance(PAYOUT_KEY, address(reentrantToken), type(uint256).max);
        reentrantToken.mint(address(safe), 1_000_000 * USDC_UNIT);

        address r = address(roles);
        companyBudget =
            budgets.create(address(safe), 0, BOARD_HAT, address(usdc), BUDGET_YEAR, 600_000e6, r, PAYOUT_KEY);
        operating =
            budgets.create(address(safe), companyBudget, CEO_HAT, address(usdc), BUDGET_YEAR, 500_000e6, r, PAYOUT_KEY);
        operations =
            budgets.create(address(safe), operating, OPS_HAT, address(usdc), BUDGET_YEAR, 250_000e6, r, PAYOUT_KEY);
        monthlyBudget = budgets.create(address(safe), 0, OPS_HAT, address(usdc), BUDGET_MONTH, 20_000e6, r, PAYOUT_KEY);
        reentrantBudget =
            budgets.create(address(safe), 0, OPS_HAT, address(reentrantToken), BUDGET_YEAR, 250_000e6, r, PAYOUT_KEY);
        // The other company has its own Safe and Roles, each paying only from itself.
        MockSafe other = new MockSafe(address(this));
        otherRoles = new MockRoles(other);
        other.enableModule(address(otherRoles));
        otherRoles.setMember(PAYOUT_KEY, address(budgets), true);
        otherRoles.allowTarget(PAYOUT_KEY, address(usdc), true);
        otherRoles.setAllowance(PAYOUT_KEY, address(usdc), type(uint256).max);
        usdc.mint(address(other), 1_000_000 * USDC_UNIT);
        otherSafe = address(other);
        vm.label(otherSafe, "Other company Safe");
        otherBudget = budgets.create(
            otherSafe, 0, OTHER_HAT, address(usdc), BUDGET_YEAR, 250_000e6, address(otherRoles), PAYOUT_KEY
        );

        hats.setWearer(CEO_HAT, users.amira, true);
        hats.setWearer(OPS_HAT, users.jordan, true);
        hats.setWearer(OTHER_HAT, users.ben, true);
    }

    // ------------------------------------------------------------------ offers

    /// @dev Jordan offers Alice 5,000 USDC a month from Operations, released monthly, open-ended,
    /// starting now, to be accepted within 7 days.
    function _offer() internal returns (uint256 id) {
        return _offerTo(users.alice, SALARY, MONTH, 0, 0, MONTHLY);
    }

    function _offerTo(
        address payee,
        uint128 rate,
        uint8 period,
        uint64 startsAt,
        uint64 endsAt,
        uint64 step
    )
        internal
        returns (uint256 id)
    {
        uint64 expiry = uint64(block.timestamp + 7 days);
        if (endsAt != 0 && expiry > endsAt) expiry = endsAt;
        vm.prank(users.jordan);
        id = agreements.offer(operations, payee, rate, period, startsAt, endsAt, step, expiry, TERMS);
    }

    function _accept(uint256 id) internal {
        vm.prank(agreements.agreementOf(id).payee);
        agreements.accept(id, TERMS);
    }

    /// @dev Alice's salary, offered and accepted now.
    function _running() internal returns (uint256 id) {
        id = _offer();
        _accept(id);
    }

    /// @dev Alice paid every second at 1,000 USDC a week from Operations, accepted now.
    function _stream() internal returns (uint256 id) {
        id = _offerTo(users.alice, 1000e6, WEEK, 0, 0, 1);
        _accept(id);
    }

    // ------------------------------------------------------------------ D10

    /// @dev Holds the D10 lock by collecting from an agreement paid in the re-entrant token, whose
    /// transfer calls `data` on Agreements. Asserts the inner call reverted `ReentrantCall()` and the
    /// outer collection still paid.
    function _assertReentryRefused(bytes memory data) internal {
        vm.prank(users.jordan);
        uint256 id = agreements.offer(
            reentrantBudget, users.alice, 1000e6, WEEK, 0, 0, 1, uint64(block.timestamp + 7 days), TERMS
        );
        _accept(id);
        vm.warp(block.timestamp + 1 days);
        reentrantToken.arm(address(agreements), data);
        uint256 before = reentrantToken.balanceOf(users.alice);
        vm.prank(users.alice);
        agreements.collect(id, 1e6);
        assertTrue(reentrantToken.reentered(), "the token called back");
        assertFalse(reentrantToken.reentrySucceeded(), "the inner call was refused");
        assertEq(bytes4(reentrantToken.reentryResult()), IAgreements.ReentrantCall.selector, "ReentrantCall");
        assertEq(reentrantToken.balanceOf(users.alice), before + 1e6, "the outer collection paid");
    }

    // ------------------------------------------------------------------ the model

    function _units(uint256 rate, uint8 period, uint256 from, uint256 to) internal pure returns (uint128) {
        return uint128(CalendarModel.units(rate, period, from, to));
    }

    function _figure(uint256 rate, uint8 period, uint8 budgetPeriod) internal pure returns (uint128) {
        return uint128(CalendarModel.periodFigure(rate, period, budgetPeriod));
    }

    function _date(uint256 year, uint256 month, uint256 day) internal pure returns (uint64) {
        return CalendarModel.date(year, month, day);
    }

    /// @dev The total of the ReservationReleased events Agreements emitted for `id` in `logs`.
    function _releasedIn(Vm.Log[] memory logs, uint256 id) internal view returns (uint256 amount) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(agreements) || logs[i].topics[0] != IAgreements.ReservationReleased.selector)
            {
                continue;
            }
            if (uint256(logs[i].topics[3]) == id) amount += abi.decode(logs[i].data, (uint128));
        }
    }

    function _now() internal view returns (uint64) {
        return uint64(vm.getBlockTimestamp());
    }
}
