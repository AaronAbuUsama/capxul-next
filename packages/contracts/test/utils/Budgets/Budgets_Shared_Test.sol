// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Base_Test } from "../../Base.t.sol";
import { Budgets } from "../../../src/money/Budgets.sol";
import { IBudgets } from "../../../src/interfaces/IBudgets.sol";
import { ICalendar } from "../../../src/interfaces/ICalendar.sol";
import { IPayments } from "../../../src/interfaces/IPayments.sol";
import { IMultiSend } from "../../../src/interfaces/external/IMultiSend.sol";
import { IRoles } from "../../../src/interfaces/external/IRoles.sol";

import { BudgetsCalendar } from "./BudgetsCalendar.sol";
import { BudgetsGateMock, BudgetsPaymentsMock, BudgetsRolesMock } from "./BudgetsMocks.sol";

/// @notice What every Budgets unit, fuzz and symbolic test shares: Budgets on the hermetic company,
/// the startup story's budget tree (M6) and the helpers that build and read it.
/// @dev Nothing here calls Budgets in `setUp`: each test builds the tree itself, so against the stub
/// every test fails on its own with `NotImplemented()` rather than one `setUp` failure for all.
abstract contract Budgets_Shared_Test is Base_Test {
    bytes32 internal constant ROLE_KEY = keccak256("capxul.v4.payout");
    address internal constant MULTI_SEND_CALL_ONLY = 0x9641d764fc13c8B624c04430C7356C1C7C8102e2;

    uint8 internal constant MONTH = ICalendar.BUDGET_MONTH;
    uint8 internal constant QUARTER = ICalendar.BUDGET_QUARTER;
    uint8 internal constant YEAR = ICalendar.BUDGET_YEAR;

    /// @dev The Board's hat tree: its top hat is worn by the company Safe, the officer hats are its
    /// children (architecture.md, the install).
    uint256 internal constant BOARD_HAT = uint256(2) << 224;
    uint256 internal constant CEO_HAT = BOARD_HAT | (uint256(1) << 208);
    uint256 internal constant OPS_HAT = BOARD_HAT | (uint256(2) << 208);
    uint256 internal constant MARKETING_HAT = BOARD_HAT | (uint256(3) << 208);
    uint256 internal constant SPARE_HAT = BOARD_HAT | (uint256(4) << 208);

    /// @dev The startup story (M6): 600,000 a year at the top, Operating 500,000 (CEO, Amira),
    /// Operations 250,000 (Ops, Jordan), Offsite 20,000 (Ops, Jordan). Marketing 50,000 (Ben) is
    /// Operations' sibling under Operating.
    uint128 internal constant TOP_AMOUNT = 600_000e6;
    uint128 internal constant OPERATING_AMOUNT = 500_000e6;
    uint128 internal constant OPERATIONS_AMOUNT = 250_000e6;
    uint128 internal constant OFFSITE_AMOUNT = 20_000e6;
    uint128 internal constant MARKETING_AMOUNT = 50_000e6;

    bytes32 internal constant DOC = keccak256("supplier invoice 42");
    bytes32 internal constant JOB = keccak256("job 1");

    Budgets internal budgets;
    BudgetsPaymentsMock internal payments;
    BudgetsRolesMock internal payoutRoles;
    BudgetsGateMock internal gate;
    address internal agreements;

    uint256 internal top;
    uint256 internal operating;
    uint256 internal operations;
    uint256 internal offsite;
    uint256 internal marketing;

    uint256 private _jobs;

    function _deployProtocol() internal virtual override {
        payments = new BudgetsPaymentsMock();
        budgets = new Budgets(address(payments), address(hats));
        gate = new BudgetsGateMock(address(safe));
        payoutRoles = new BudgetsRolesMock(safe, address(gate));
        safe.enableModule(address(payoutRoles));
        payoutRoles.setMember(ROLE_KEY, address(budgets), true);
        agreements = makeAddr("agreements");

        hats.setWearer(BOARD_HAT, address(safe), true);
        hats.setWearer(CEO_HAT, users.amira, true);
        hats.setWearer(OPS_HAT, users.jordan, true);
        hats.setWearer(MARKETING_HAT, users.ben, true);

        reentrantToken.mint(address(safe), 1_000_000 * USDC_UNIT);
        dai.mint(address(safe), 1_000_000 ether);

        vm.label(address(budgets), "Budgets");
        vm.label(address(payments), "Payments (stand-in)");
        vm.label(address(payoutRoles), "Roles (payout)");
        vm.label(address(gate), "Signer Gate");
    }

    // ------------------------------------------------------------------ building

    /// @dev Companies House names Agreements; the Safe points Budgets at its Roles and payout role.
    function _wire() internal {
        budgets.setAgreements(agreements);
        vm.prank(address(safe));
        budgets.configure(address(payoutRoles), ROLE_KEY);
    }

    function _createTop(address token, uint8 period, uint128 amount, uint256 hat) internal returns (uint256 id) {
        vm.prank(address(safe));
        id = budgets.createTopBudget(token, period, amount, hat);
    }

    function _createChild(address caller, uint256 parent, uint128 amount, uint256 hat) internal returns (uint256 id) {
        vm.prank(caller);
        id = budgets.createChildBudget(parent, amount, hat);
    }

    /// @dev The startup story's tree in USDC with `period`.
    function _tree(uint8 period) internal {
        _wire();
        top = _createTop(address(usdc), period, TOP_AMOUNT, BOARD_HAT);
        operating = _createChild(address(safe), top, OPERATING_AMOUNT, CEO_HAT);
        operations = _createChild(users.amira, operating, OPERATIONS_AMOUNT, OPS_HAT);
        offsite = _createChild(users.jordan, operations, OFFSITE_AMOUNT, OPS_HAT);
    }

    function _tree() internal {
        _tree(YEAR);
    }

    /// @dev The tree plus Marketing beside Operations.
    function _treeWithSibling(uint8 period) internal {
        _tree(period);
        marketing = _createChild(users.amira, operating, MARKETING_AMOUNT, MARKETING_HAT);
    }

    /// @dev A chain of `depth` budgets, each 1,000 under the one above, all worn by Jordan's Ops hat
    /// below the top. Returns the deepest.
    function _chain(uint256 depth) internal returns (uint256 id) {
        _wire();
        id = _createTop(address(usdc), YEAR, TOP_AMOUNT, BOARD_HAT);
        for (uint256 d = 2; d <= depth; ++d) {
            id = _createChild(address(safe), id, uint128(TOP_AMOUNT - d * 1000e6), OPS_HAT);
        }
    }

    function _spend(address caller, uint256 id, uint128 amount) internal returns (bytes32 paymentId) {
        vm.prank(caller);
        paymentId = budgets.spend(id, users.alice, amount, 0, DOC, _nextJob());
    }

    function _schedule(address caller, uint256 id, uint128 amount, uint64 payAt) internal returns (uint256 sid) {
        vm.prank(caller);
        sid = budgets.schedule(id, users.bob, amount, 1, payAt, DOC, _nextJob());
    }

    function _commit(uint256 id, uint128 amount) internal {
        vm.prank(agreements);
        budgets.commit(id, amount);
    }

    function _close(address caller, uint256 id) internal {
        vm.prank(caller);
        budgets.close(id);
    }

    function _nextJob() internal returns (bytes32) {
        return keccak256(abi.encode("job", ++_jobs));
    }

    // ------------------------------------------------------------------ reading

    function _budget(uint256 id) internal view returns (IBudgets.Budget memory) {
        return budgets.budgetOf(id);
    }

    function _scheduled(uint256 sid) internal view returns (IBudgets.Scheduled memory) {
        return budgets.scheduledOf(sid);
    }

    /// @dev What a budget uses: own spend plus own commitments plus its children's amounts (B1, D8).
    function _used(uint256 id) internal view returns (uint128) {
        IBudgets.Budget memory b = budgets.budgetOf(id);
        return b.ownSpent + b.ownCommitted + b.childrenAmount;
    }

    // ------------------------------------------------------------------ the payout

    /// @dev The Payments item Budgets must build: the Safe as executor, the id from Payments.
    function _item(
        address recipient,
        address token,
        uint256 amount,
        uint16 kind,
        bytes32 documentHash,
        bytes32 jobNonce
    )
        internal
        view
        returns (IPayments.PaymentItem memory item)
    {
        item = IPayments.PaymentItem({
            paymentId: bytes32(0),
            recipient: recipient,
            token: token,
            amount: amount,
            kind: kind,
            documentHash: documentHash,
            jobNonce: jobNonce,
            executor: address(safe)
        });
        item.paymentId = payments.paymentId(item);
    }

    /// @dev The one Roles call of a payout (spec "Paying", as beta `PayrollDepartments.collect`):
    /// MultiSendCallOnly by delegatecall batching `approve(payments, amount)` then `send(item)`.
    function _payoutCall(IPayments.PaymentItem memory item) internal view returns (bytes memory) {
        bytes memory approve = abi.encodeWithSignature("approve(address,uint256)", address(payments), item.amount);
        bytes memory send = abi.encodeCall(IPayments.send, (item));
        bytes memory batch = abi.encodePacked(
            uint8(0),
            item.token,
            uint256(0),
            approve.length,
            approve,
            uint8(0),
            address(payments),
            uint256(0),
            send.length,
            send
        );
        return abi.encodeCall(
            IRoles.execTransactionWithRole,
            (MULTI_SEND_CALL_ONLY, 0, abi.encodeCall(IMultiSend.multiSend, (batch)), 1, ROLE_KEY, true)
        );
    }

    function _expectPayout(IPayments.PaymentItem memory item) internal {
        vm.expectCall(address(payoutRoles), _payoutCall(item), 1);
    }

    /// @dev Spend's job nonce: bound to this Budgets and the budget (spec `spend`).
    function _spendJob(uint256 id, bytes32 jobNonce) internal view returns (bytes32) {
        return keccak256(abi.encode(address(budgets), id, jobNonce));
    }

    /// @dev A scheduled payment's job nonce (spec `execute`): the one `spend` derives, from its own nonce.
    function _scheduledJob(uint256 sid) internal view returns (bytes32) {
        IBudgets.Scheduled memory s = budgets.scheduledOf(sid);
        return keccak256(abi.encode(address(budgets), s.budgetId, s.jobNonce));
    }

    // ------------------------------------------------------------------ re-entry (D10)

    /// @dev A top budget in the re-entrant token, so a payout from it calls back into Budgets.
    function _reentrantBudget() internal returns (uint256 id) {
        id = _createTop(address(reentrantToken), YEAR, 100_000e6, BOARD_HAT);
    }

    /// @dev The lock leaf of every state-changing function: `call` made from inside a payout is
    /// refused with `ReentrantCall`, whoever makes it and whatever its arguments.
    function _assertLockRefuses(bytes memory call) internal {
        _wire();
        uint256 r = _reentrantBudget();
        reentrantToken.arm(address(budgets), call);
        vm.prank(address(safe));
        budgets.spend(r, users.alice, 1e6, 0, DOC, JOB);
        _assertReentryWasRefused();
    }

    function _assertReentryWasRefused() internal view {
        assertTrue(reentrantToken.reentered(), "the token re-entered");
        assertFalse(reentrantToken.reentrySucceeded(), "the re-entry was refused");
        assertEq(
            reentrantToken.reentryResult(),
            abi.encodeWithSelector(IBudgets.ReentrantCall.selector),
            "refused with ReentrantCall"
        );
    }

    // ------------------------------------------------------------------ time

    function _periodIndex(uint8 period, uint256 t) internal pure returns (uint64) {
        return BudgetsCalendar.periodIndex(period, t);
    }

    function _timestamp(uint256 y, uint256 m, uint256 d) internal pure returns (uint64) {
        return BudgetsCalendar.timestamp(y, m, d);
    }
}
