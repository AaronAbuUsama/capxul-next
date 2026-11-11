// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IBudgets } from "../../../../../src/interfaces/IBudgets.sol";
import { IPayments } from "../../../../../src/interfaces/IPayments.sol";

import { Budgets_Shared_Test } from "../../../../utils/Budgets/Budgets_Shared_Test.sol";

/// @notice spec/budgets.md `spend` (B1, B2, B3, B11 / N-9, D10). Ports the shape of Firm `Budget.t.sol`
/// testAllowanceIsKeptTrackOfOnSingle, testAllowanceChain, testCantExecuteIfNotAuthorized and
/// testCantExecutePaymentWithZeroAmount, and of beta `PayrollDepartments.fork.t.sol`
/// test_eachCollectionIsAStampedV3Payment (the payout batch).
contract Spend_Budgets_Unit_Concrete_Test is Budgets_Shared_Test {
    function test_WhenACallIntoBudgetsIsAlreadyRunning() external {
        // it should revert with ReentrantCall
        _assertLockRefuses(abi.encodeCall(IBudgets.spend, (1, users.eve, 1, 0, DOC, keccak256("eve"))));
    }

    function test_WhenTheBudgetDoesNotExist() external {
        _tree();
        // it should revert with UnknownBudget
        vm.prank(address(safe));
        vm.expectRevert(abi.encodeWithSelector(IBudgets.UnknownBudget.selector, uint256(999)));
        budgets.spend(999, users.alice, 1, 0, DOC, JOB);
    }

    function test_WhenTheCallerIsNotAuthorisedForTheBudget() external {
        _treeWithSibling(YEAR);
        // it should revert with NotAuthorised
        vm.prank(users.eve);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotAuthorised.selector, operations, users.eve));
        budgets.spend(operations, users.eve, 1, 0, DOC, JOB);

        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotAuthorised.selector, operating, users.jordan));
        budgets.spend(operating, users.alice, 1, 0, DOC, JOB);

        vm.prank(users.ben);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotAuthorised.selector, operations, users.ben));
        budgets.spend(operations, users.alice, 1, 0, DOC, JOB);
    }

    modifier whenTheCallerIsAuthorised() {
        _tree();
        _;
    }

    function test_WhenTheBudgetOrAnyBudgetAboveItIsClosed() external whenTheCallerIsAuthorised {
        _close(address(safe), operating);
        // it should revert with BudgetIsClosed naming the nearest closed budget
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.BudgetIsClosed.selector, operating));
        budgets.spend(offsite, users.alice, 1, 0, DOC, JOB);

        _close(users.jordan, offsite);
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.BudgetIsClosed.selector, offsite));
        budgets.spend(offsite, users.alice, 1, 0, DOC, JOB);
    }

    function test_WhenTheAmountIs0() external whenTheCallerIsAuthorised {
        // it should revert with ZeroAmount
        vm.prank(users.jordan);
        vm.expectRevert(IBudgets.ZeroAmount.selector);
        budgets.spend(offsite, users.alice, 0, 0, DOC, JOB);
    }

    function test_WhenTheKindIsAbove3() external whenTheCallerIsAuthorised {
        // it should revert with InvalidKind
        uint16[3] memory kinds = [uint16(4), 8, type(uint16).max];
        for (uint256 i; i < kinds.length; ++i) {
            vm.prank(users.jordan);
            vm.expectRevert(abi.encodeWithSelector(IBudgets.InvalidKind.selector, kinds[i]));
            budgets.spend(offsite, users.alice, 1, kinds[i], DOC, JOB);
        }
    }

    function test_WhenTheDocumentHashIsZero() external whenTheCallerIsAuthorised {
        // it should revert with ZeroDocumentHash
        vm.prank(users.jordan);
        vm.expectRevert(IBudgets.ZeroDocumentHash.selector);
        budgets.spend(offsite, users.alice, 1, 0, bytes32(0), JOB);
    }

    function test_WhenTheJobNonceIsZero() external whenTheCallerIsAuthorised {
        // it should revert with ZeroJobNonce
        vm.prank(users.jordan);
        vm.expectRevert(IBudgets.ZeroJobNonce.selector);
        budgets.spend(offsite, users.alice, 1, 0, DOC, bytes32(0));
    }

    modifier whenTheInputsAreValid() {
        _;
    }

    function test_GivenThePeriodHasTurnedSinceTheBudgetWasLastUsed()
        external
        whenTheCallerIsAuthorised
        whenTheInputsAreValid
    {
        _spend(users.jordan, offsite, 15_000e6);
        assertEq(_budget(top).spent, 15_000e6, "2026 spend reaches the top");

        vm.warp(_timestamp(2027, 1, 1));
        // it should start ownSpent and spent over at 0 on every stale budget up the tree before checking
        _spend(users.jordan, offsite, OFFSITE_AMOUNT);
        uint256[4] memory path = [offsite, operations, operating, top];
        for (uint256 i; i < 4; ++i) {
            IBudgets.Budget memory b = _budget(path[i]);
            assertEq(b.spent, OFFSITE_AMOUNT, "spent is this year's only");
            assertEq(b.periodIndex, 2027, "rolled to 2027");
        }
        assertEq(_budget(offsite).ownSpent, OFFSITE_AMOUNT, "Offsite's own spend is this year's only");
        assertEq(_budget(operations).ownSpent, 0, "Operations spent nothing itself");
    }

    function test_GivenASiblingsSpendRolledTheParentIntoTheNewPeriodFirst()
        external
        whenTheCallerIsAuthorised
        whenTheInputsAreValid
    {
        // N-9 (research R1 B-15): Marketing rolls Operating into 2027 before Offsite is touched.
        marketing = _createChild(users.amira, operating, MARKETING_AMOUNT, MARKETING_HAT);
        _spend(users.jordan, offsite, OFFSITE_AMOUNT);
        assertEq(budgets.leftOf(offsite), 0, "Offsite spent out in 2026");

        vm.warp(_timestamp(2027, 1, 1));
        _spend(users.ben, marketing, 1000e6);
        assertEq(_budget(operating).spent, 1000e6, "Operating rolled by Marketing's spend");

        // it should still start the child's own spend at 0 and let it spend its whole amount
        assertEq(budgets.leftOf(offsite), OFFSITE_AMOUNT, "Offsite reads its whole amount");
        // Every view returns effective values: the stale branch reads 0 before it is touched.
        assertEq(_budget(offsite).ownSpent, 0, "Offsite's stale own spend reads 0");
        assertEq(_budget(offsite).spent, 0, "Offsite's stale spent reads 0");
        assertEq(_budget(operations).spent, 0, "Operations' stale spent reads 0");
        assertEq(_budget(operations).periodIndex, 2027, "a stale budget reads the current index");
        _spend(users.jordan, offsite, OFFSITE_AMOUNT);
        assertEq(_budget(offsite).ownSpent, OFFSITE_AMOUNT, "Offsite's own spend");
        assertEq(_budget(operations).spent, OFFSITE_AMOUNT, "Operations' spent");
        assertEq(_budget(operating).spent, OFFSITE_AMOUNT + 1000e6, "Operating's spent: both branches");
        assertEq(_budget(top).spent, OFFSITE_AMOUNT + 1000e6, "the top's spent");
    }

    function test_WhenTheAmountIsMoreThanIsLeftInTheBudget() external whenTheCallerIsAuthorised whenTheInputsAreValid {
        // it should revert with OverBudget with the budget and what is left
        vm.prank(users.jordan);
        vm.expectRevert(
            abi.encodeWithSelector(IBudgets.OverBudget.selector, offsite, OFFSITE_AMOUNT, OFFSITE_AMOUNT + 1)
        );
        budgets.spend(offsite, users.alice, OFFSITE_AMOUNT + 1, 0, DOC, JOB);

        // Operations' own room excludes what Offsite holds and what is committed (B1).
        _commit(operations, 30_000e6);
        uint128 left = OPERATIONS_AMOUNT - OFFSITE_AMOUNT - 30_000e6;
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.OverBudget.selector, operations, left, left + 1));
        budgets.spend(operations, users.alice, left + 1, 0, DOC, JOB);
    }

    modifier whenTheAmountFitsWhatIsLeft() {
        _;
    }

    function test_WhenTheAmountFitsWhatIsLeft()
        external
        whenTheCallerIsAuthorised
        whenTheInputsAreValid
        whenTheAmountFitsWhatIsLeft
    {
        uint128 amount = 5000e6;
        IPayments.PaymentItem memory item = _item(users.alice, address(usdc), amount, 2, DOC, _spendJob(offsite, JOB));
        uint256 safeBefore = usdc.balanceOf(address(safe));
        uint256 aliceBefore = usdc.balanceOf(users.alice);

        // it should pay through the payout role as approve then send in one MultiSend
        // it should derive the job nonce from this contract and the budget and the caller's nonce
        // it should make the Safe the payment's executor
        _expectPayout(item);
        // it should emit Spent
        vm.expectEmit(true, true, true, true, address(budgets));
        emit IBudgets.Spent(address(safe), offsite, users.alice, amount, 2, DOC, item.paymentId);
        vm.prank(users.jordan);
        bytes32 paymentId = budgets.spend(offsite, users.alice, amount, 2, DOC, JOB);

        // it should return the payment id
        assertEq(paymentId, item.paymentId, "payment id");
        assertTrue(payments.paid(paymentId), "Payments consumed it");
        assertEq(usdc.balanceOf(address(safe)), safeBefore - amount, "the Safe paid");
        assertEq(usdc.balanceOf(users.alice), aliceBefore + amount, "Alice was paid");

        // it should add the amount to ownSpent on the budget
        assertEq(_budget(offsite).ownSpent, amount, "Offsite ownSpent");
        // it should add the amount to spent on the budget and every budget above it
        uint256[4] memory path = [offsite, operations, operating, top];
        for (uint256 i; i < 4; ++i) {
            assertEq(_budget(path[i]).spent, amount, "spent up the tree (B2)");
        }
        assertEq(_budget(operations).ownSpent, 0, "only Offsite's own spend grew");
        assertEq(budgets.leftOf(offsite), OFFSITE_AMOUNT - amount, "left");

        // it should write the spend before the payout call
        uint256 r = _reentrantBudget();
        reentrantToken.arm(address(budgets), abi.encodeCall(IBudgets.budgetOf, (r)));
        vm.prank(address(safe));
        budgets.spend(r, users.alice, 7e6, 0, DOC, JOB);
        assertTrue(reentrantToken.reentrySucceeded(), "a view is not locked");
        IBudgets.Budget memory seen = abi.decode(reentrantToken.reentryResult(), (IBudgets.Budget));
        assertEq(seen.ownSpent, 7e6, "the spend was stored before the token moved");
    }

    function test_GivenTheAmountIsExactlyWhatIsLeft()
        external
        whenTheCallerIsAuthorised
        whenTheInputsAreValid
        whenTheAmountFitsWhatIsLeft
    {
        _spend(users.jordan, offsite, 4000e6);
        // it should pay it and leave 0
        uint256 before = usdc.balanceOf(users.alice);
        _spend(users.jordan, offsite, OFFSITE_AMOUNT - 4000e6);
        assertEq(usdc.balanceOf(users.alice), before + OFFSITE_AMOUNT - 4000e6, "paid");
        assertEq(budgets.leftOf(offsite), 0, "nothing left");
    }

    function test_WhenRolesRefusesBecauseThePayoutAllowanceIsUsedUp()
        external
        whenTheCallerIsAuthorised
        whenTheInputsAreValid
        whenTheAmountFitsWhatIsLeft
    {
        payoutRoles.setAllowance(address(usdc), 1000e6);
        uint256 safeBefore = usdc.balanceOf(address(safe));
        // it should revert and change nothing
        vm.prank(users.jordan);
        vm.expectRevert();
        budgets.spend(offsite, users.alice, 1000e6 + 1, 0, DOC, JOB);

        assertEq(_budget(offsite).ownSpent, 0, "no spend recorded");
        assertEq(_budget(top).spent, 0, "nothing up the tree");
        assertEq(usdc.balanceOf(address(safe)), safeBefore, "no money moved");
        assertEq(payments.sends(), 0, "no payment consumed");
        // Within the allowance it pays (the refusal was Roles').
        _spend(users.jordan, offsite, 1000e6);
        assertEq(_budget(offsite).ownSpent, 1000e6, "paid within the allowance");
    }

    function test_WhenTheTokenRe_entersBudgetsDuringThePayout()
        external
        whenTheCallerIsAuthorised
        whenTheInputsAreValid
        whenTheAmountFitsWhatIsLeft
    {
        uint256 r = _reentrantBudget();
        uint256 eveBefore = reentrantToken.balanceOf(users.eve);
        reentrantToken.arm(
            address(budgets), abi.encodeCall(IBudgets.spend, (r, users.eve, 50e6, 0, DOC, keccak256("again")))
        );
        vm.prank(address(safe));
        budgets.spend(r, users.alice, 10e6, 0, DOC, JOB);
        // it should revert the inner call with ReentrantCall
        _assertReentryWasRefused();
        assertEq(reentrantToken.balanceOf(users.eve), eveBefore, "the inner spend paid nothing");
        assertEq(_budget(r).ownSpent, 10e6, "only the outer spend counted");
    }
}
