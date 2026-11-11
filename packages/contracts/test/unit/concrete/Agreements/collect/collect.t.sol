// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IAgreements } from "../../../../../src/interfaces/IAgreements.sol";
import { MockRoles } from "../../../../mocks/MockRoles.sol";
import { CalendarModel } from "../../../../utils/Agreements/CalendarModel.sol";
import { MockBudgets } from "../../../../utils/Agreements/MockBudgets.sol";
import { Agreements_Unit_Shared } from "../../../../utils/Agreements/Agreements_Unit_Shared.sol";

/// @notice spec/agreements.md `collect` (through `Budgets.payReserved`, D10); invariants A1, A5, A7, A8,
/// A11. Ports beta `PayrollDepartments.fork.t.sol:272`, `:287`, `:315`, `:329`, `:342` (release steps),
/// `:468` (one Payment per collection, fresh job nonce), `:496` (only the payee, no zero or over-release
/// amount) and `PayrollDepartmentsEdges.fork.t.sol:350`, `:402` (a refused collection consumes nothing).
contract Collect_Agreements_Unit_Concrete_Test is Agreements_Unit_Shared {
    uint256 internal id;
    uint64 internal t0;

    function test_WhenACallIntoAgreementsIsAlreadyRunning() external {
        // The helper's agreement is id 1; the token re-enters collect on it.
        // it should revert with ReentrantCall
        _assertReentryRefused(abi.encodeCall(IAgreements.collect, (1, 1e6)));
        assertEq(agreements.agreementOf(1).collected, 1e6, "only the outer collection counted");
        assertEq(agreements.agreementOf(1).collections, 1, "one collection");
    }

    function test_WhenTheAgreementDoesNotExist() external {
        // it should revert with InvalidAgreement
        vm.prank(users.alice);
        vm.expectRevert(IAgreements.InvalidAgreement.selector);
        agreements.collect(42, 1);
    }

    function test_WhenTheCallerIsNotThePayee() external {
        id = _stream();
        vm.warp(_now() + 7 days);
        address[4] memory others = [address(users.eve), users.jordan, users.amira, address(safe)];
        for (uint256 i; i < others.length; ++i) {
            // it should revert with NotThePayee
            vm.prank(others[i]);
            vm.expectRevert(IAgreements.NotThePayee.selector);
            agreements.collect(id, 1e6);
        }
    }

    function test_WhenTheAgreementIsNotAccepted() external {
        id = _offer();
        vm.warp(_now() + 40 days);
        // it should revert with NotAccepted
        vm.prank(users.alice);
        vm.expectRevert(IAgreements.NotAccepted.selector);
        agreements.collect(id, 1);
    }

    function test_WhenTheAmountIs0() external {
        id = _stream();
        vm.warp(_now() + 7 days);
        // it should revert with InvalidAmount
        vm.prank(users.alice);
        vm.expectRevert(IAgreements.InvalidAmount.selector);
        agreements.collect(id, 0);
    }

    modifier whenThePayeeCollectsAPositiveAmount() {
        id = _stream(); // 1,000 USDC a week, released every second
        t0 = _now();
        _;
    }

    function test_WhenThePayeeCollectsAPositiveAmount() external whenThePayeeCollectsAPositiveAmount {
        vm.warp(t0 + 1 days);
        vm.prank(users.alice);
        agreements.collect(id, 1e6);
        // it should accrue to now first
        IAgreements.Agreement memory a = agreements.agreementOf(id);
        assertEq(a.accruedAt, t0 + 1 days, "checkpoint moved to now");
        assertEq(a.earnedScaled, CalendarModel.pay(1000e6, WEEK, t0, t0 + 1 days), "earned to now");
        assertEq(a.releasedScaled, a.earnedScaled, "a one-second step releases all of it");
    }

    function test_WhenTheAmountIsMoreThanIsReleasedAndNotCollected() external whenThePayeeCollectsAPositiveAmount {
        vm.warp(t0 + 7 days);
        // it should revert with InsufficientReleased with what is available
        vm.prank(users.alice);
        vm.expectRevert(abi.encodeWithSelector(IAgreements.InsufficientReleased.selector, 1000e6, 1000e6 + 1));
        agreements.collect(id, 1000e6 + 1);

        // A monthly release has nothing out before the 1st.
        uint256 salary = _running();
        vm.warp(_date(2026, 1, 20));
        vm.prank(users.alice);
        vm.expectRevert(abi.encodeWithSelector(IAgreements.InsufficientReleased.selector, 0, 1));
        agreements.collect(salary, 1);
    }

    modifier whenTheAmountIsAvailable() {
        _;
    }

    function test_WhenTheAmountIsAvailable() external whenThePayeeCollectsAPositiveAmount whenTheAmountIsAvailable {
        vm.warp(t0 + 7 days);
        bytes32 nonce0 = keccak256(abi.encode(address(agreements), id, uint64(0)));
        bytes32 nonce1 = keccak256(abi.encode(address(agreements), id, uint64(1)));
        bytes32 paymentId0 = _paymentId(400e6, nonce0);
        uint256 before = usdc.balanceOf(users.alice);
        // it should emit Collected
        vm.expectEmit(address(agreements));
        emit IAgreements.Collected(address(safe), id, users.alice, address(usdc), 400e6, paymentId0);
        vm.prank(users.alice);
        agreements.collect(id, 400e6);
        // it should add it to collected
        assertEq(agreements.agreementOf(id).collected, 400e6, "collected");
        assertEq(agreements.availableOf(id), 600e6, "the rest of the week");
        assertEq(usdc.balanceOf(users.alice), before + 400e6, "Alice was paid");
        // it should pay it through Budgets payReserved with kind 4 and the agreement's document hash
        MockBudgets.Pay memory p = budgets.payAt(0);
        assertEq(p.budgetId, operations, "from the agreement's budget");
        assertEq(p.recipient, users.alice, "to the payee");
        assertEq(p.amount, 400e6, "the amount");
        assertEq(p.kind, 4, "agreement collection");
        assertEq(p.documentHash, TERMS, "the agreement's document");
        assertEq(p.jobNonce, nonce0, "keccak256(agreements, id, 0)");
        // it should use a new job nonce for each collection
        vm.prank(users.alice);
        agreements.collect(id, 100e6);
        assertEq(budgets.payAt(1).jobNonce, nonce1, "keccak256(agreements, id, 1)");
        assertTrue(nonce0 != nonce1, "distinct");
        assertEq(agreements.agreementOf(id).collections, 2, "two collections");
        assertEq(budgets.ownCommitted(operations), 53_000e6, "collections never touch the reservation");
    }

    function test_GivenTheReleaseStepIsMONTHLY() external whenThePayeeCollectsAPositiveAmount whenTheAmountIsAvailable {
        vm.warp(_date(2026, 1, 15));
        uint64 accepted = _now();
        uint256 salary = _offerTo(users.bob, SALARY, MONTH, 0, 0, MONTHLY);
        _accept(salary);
        // it should release each month's pay at 00:00 UTC on the 1st
        vm.warp(_date(2026, 2, 1) - 1);
        assertEq(agreements.availableOf(salary), 0, "nothing before the 1st");
        vm.warp(_date(2026, 2, 1));
        uint128 january = _units(SALARY, MONTH, accepted, _date(2026, 2, 1));
        assertEq(agreements.availableOf(salary), january, "the part of January from the 15th");
        vm.prank(users.bob);
        agreements.collect(salary, january);
        vm.warp(_date(2026, 3, 1) - 1);
        assertEq(agreements.availableOf(salary), 0, "February waits for 1 March");
        vm.warp(_date(2026, 3, 1));
        assertEq(agreements.availableOf(salary), SALARY, "a whole February pays a whole month");
    }

    function test_GivenTheReleaseStepIsOneSecond()
        external
        whenThePayeeCollectsAPositiveAmount
        whenTheAmountIsAvailable
    {
        // it should release pay every second
        vm.warp(t0 + 1);
        uint128 first = _units(1000e6, WEEK, t0, t0 + 1);
        assertGt(first, 0, "a second's pay");
        assertEq(agreements.availableOf(id), first, "released after one second");
        vm.prank(users.alice);
        agreements.collect(id, first);
        vm.warp(t0 + 2);
        assertEq(agreements.availableOf(id), _units(1000e6, WEEK, t0, t0 + 2) - first, "and the next second");
    }

    function test_GivenTheAgreementHasEnded() external whenThePayeeCollectsAPositiveAmount whenTheAmountIsAvailable {
        uint256 salary = _offerTo(users.bob, SALARY, MONTH, 0, 0, MONTHLY);
        _accept(salary);
        vm.prank(users.jordan);
        agreements.end(salary, _date(2026, 1, 11));
        vm.warp(_date(2026, 3, 1));
        // it should release everything earned up to the end and nothing after
        uint128 owed = _units(SALARY, MONTH, t0, _date(2026, 1, 11));
        assertEq(agreements.availableOf(salary), owed, "the ten days, part month included");
        vm.prank(users.bob);
        agreements.collect(salary, owed);
        assertEq(agreements.availableOf(salary), 0, "nothing after the end");
        assertEq(agreements.earnedOf(salary), 0, "nothing more earned");
    }

    function test_GivenTheBudgetIsClosed() external whenThePayeeCollectsAPositiveAmount whenTheAmountIsAvailable {
        vm.warp(t0 + 7 days);
        budgets.setClosed(operations, true);
        budgets.setClosed(operating, true);
        // it should still pay
        vm.prank(users.alice);
        agreements.collect(id, 1000e6);
        assertEq(agreements.agreementOf(id).collected, 1000e6, "paid from the reservation");
    }

    function test_GivenARateLoweringsDateHasPassed()
        external
        whenThePayeeCollectsAPositiveAmount
        whenTheAmountIsAvailable
    {
        vm.prank(users.jordan);
        agreements.changeRate(id, 500e6, t0 + 3 days);
        vm.warp(t0 + 5 days);
        // it should release the difference of the period figures and keep the agreement open
        vm.expectEmit(address(agreements));
        emit IAgreements.ReservationReleased(address(safe), operations, id, 26_500e6); // (1,000 - 500) x 53
        vm.prank(users.alice);
        agreements.collect(id, 1e6);
        assertEq(agreements.agreementOf(id).reserved, 26_500e6, "500 a week for 53 weeks");
        assertEq(budgets.ownCommitted(operations), 26_500e6, "the budget agrees");
        assertFalse(agreements.agreementOf(id).closed, "still open");
    }

    function test_GivenTheAgreementsEndHasPassed()
        external
        whenThePayeeCollectsAPositiveAmount
        whenTheAmountIsAvailable
    {
        vm.prank(users.jordan);
        agreements.end(id, t0 + 3 days);
        vm.warp(t0 + 5 days);
        // it should release what is left of its reservation
        vm.expectEmit(address(agreements));
        emit IAgreements.ReservationReleased(address(safe), operations, id, 53_000e6);
        vm.prank(users.alice);
        agreements.collect(id, 1e6);
        assertTrue(agreements.agreementOf(id).closed, "closed");
        assertEq(agreements.agreementOf(id).reserved, 53_000e6, "the record keeps what it reserved");
        assertEq(budgets.ownCommitted(operations), 0, "freed in the budget");
    }

    function test_WhenRolesOrTheSafesBalanceOrTheTokenRefusesThePayout()
        external
        whenThePayeeCollectsAPositiveAmount
        whenTheAmountIsAvailable
    {
        vm.warp(t0 + 7 days);
        // it should revert whole and leave collected and collections and what is owed unchanged
        // 1. Roles: the payout allowance has 10 USDC left.
        roles.setAllowance(PAYOUT_KEY, address(usdc), 10e6);
        vm.prank(users.alice);
        vm.expectPartialRevert(MockRoles.AllowanceExceeded.selector);
        agreements.collect(id, 500e6);
        _assertNothingConsumed();
        roles.setAllowance(PAYOUT_KEY, address(usdc), type(uint256).max);

        // 2. The Safe's balance: 100 USDC left.
        deal(address(usdc), address(safe), 100e6);
        vm.prank(users.alice);
        vm.expectRevert(MockRoles.ModuleTransactionFailed.selector);
        agreements.collect(id, 500e6);
        _assertNothingConsumed();
        deal(address(usdc), address(safe), 1_000_000e6);

        // 3. The token: a token that returns false and moves nothing.
        roles.allowTarget(PAYOUT_KEY, address(falseToken), true);
        roles.setAllowance(PAYOUT_KEY, address(falseToken), type(uint256).max);
        falseToken.mint(address(safe), 1_000_000e6);
        uint256 falseBudget = budgets.create(
            address(safe), 0, OPS_HAT, address(falseToken), BUDGET_YEAR, 100_000e6, address(roles), PAYOUT_KEY
        );
        vm.prank(users.jordan);
        uint256 refused = agreements.offer(falseBudget, users.bob, 1000e6, WEEK, 0, 0, 1, _now() + 1 days, TERMS);
        _accept(refused);
        vm.warp(_now() + 7 days);
        vm.prank(users.bob);
        vm.expectRevert(MockBudgets.PayoutRefused.selector);
        agreements.collect(refused, 500e6);
        assertEq(agreements.agreementOf(refused).collected, 0, "nothing collected");
        assertEq(agreements.agreementOf(refused).collections, 0, "no job nonce used");
        assertEq(agreements.availableOf(refused), 1000e6, "the week is still owed");

        // Once Roles and the Safe allow it, the same collection pays with the first job nonce.
        vm.prank(users.alice);
        agreements.collect(id, 500e6);
        assertEq(budgets.payAt(0).jobNonce, keccak256(abi.encode(address(agreements), id, uint64(0))), "nonce 0");
    }

    function test_WhenTheTokenRe_entersAgreementsDuringPayReserved()
        external
        whenThePayeeCollectsAPositiveAmount
        whenTheAmountIsAvailable
    {
        // The re-entering token calls settle, accept and collect in turn; each inner call is refused.
        // it should revert the inner call with ReentrantCall
        _assertReentryRefused(abi.encodeCall(IAgreements.settle, (operations)));
        _assertReentryRefused(abi.encodeCall(IAgreements.collect, (id, 1)));
        assertEq(agreements.agreementOf(id).collected, 0, "Alice's agreement untouched");
    }

    function _assertNothingConsumed() internal view {
        IAgreements.Agreement memory a = agreements.agreementOf(id);
        assertEq(a.collected, 0, "collected unchanged");
        assertEq(a.collections, 0, "collections unchanged");
        assertEq(agreements.availableOf(id), 1000e6, "the week is still owed");
        assertEq(budgets.payCount(), 0, "no payment made");
    }

    function _paymentId(uint128 amount, bytes32 nonce) internal view returns (bytes32) {
        return keccak256(
            abi.encode(address(budgets), operations, users.alice, address(usdc), amount, uint16(4), TERMS, nonce)
        );
    }
}
