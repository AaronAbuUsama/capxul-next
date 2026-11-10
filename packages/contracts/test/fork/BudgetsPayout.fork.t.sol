// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Budgets } from "../../src/money/Budgets.sol";
import { IBudgets } from "../../src/interfaces/IBudgets.sol";
import { IPayments } from "../../src/interfaces/IPayments.sol";
import { IRoles as IRolesV2 } from "../../src/interfaces/external/IRoles.sol";
import { BudgetsPaymentsMock } from "../utils/Budgets/BudgetsMocks.sol";

import { Addresses } from "./Addresses.sol";
import { Fork_Test } from "./Fork_Test.t.sol";

/// @dev Roles 2.1 functions this file needs beyond the shared fork interfaces.
interface IRolesExtra {
    function setTransactionUnwrapper(address to, bytes4 selector, address adapter) external;
    function allowances(bytes32 key)
        external
        view
        returns (uint128 refill, uint128 maxRefill, uint64 period, uint128 balance, uint64 timestamp);
}

/// @notice Budgets' payout on the real stack (spec/budgets.md "Paying"; invariants B5 and B8): Budgets ->
/// Roles 2.1 (a module on Hats Signer Gate v2) -> the Gate -> the company Safe 1.4.1 -> MultiSendCallOnly
/// 1.4.1 -> `approve` + `Payments.send`, with Roles' payout role scoped as `payroll-payout-role.ts` scopes
/// it (one token, `approve` to Payments only, `send` in that token within its allowance). Ports beta
/// `PayrollDepartments.fork.t.sol` test_rolesCapsEvenABrokenContract and test_aCollectionSpendsThePayoutAllowance.
/// @dev Payments is the hermetic stand-in until W1's Payments is deployed in Fork_Test's install.
contract BudgetsPayout_Fork_Test is Fork_Test {
    bytes32 internal constant PAYOUT_ROLE = keccak256("capxul.v4.payout");
    bytes32 internal constant PAYOUT_ALLOWANCE = keccak256("capxul.v4.payout.usdc");
    uint128 internal constant CEILING = 10_000e6;
    bytes32 internal constant DOC = keccak256("supplier invoice 42");

    uint8 internal constant STATIC = 1;
    uint8 internal constant TUPLE = 3;
    uint8 internal constant CALLDATA = 5;
    uint8 internal constant PASS = 0;
    uint8 internal constant MATCHES = 5;
    uint8 internal constant EQUAL_TO = 16;
    uint8 internal constant WITHIN_ALLOWANCE = 28;

    Budgets internal budgets;
    BudgetsPaymentsMock internal payments;
    uint256 internal opsHat;
    uint256 internal top;
    uint256 internal operations;

    function setUp() public override {
        super.setUp();
        payments = new BudgetsPaymentsMock();
        budgets = new Budgets(address(payments), Addresses.HATS);
        vm.label(address(budgets), "Budgets");
        // The Ops hat, worn by Jordan (real Hats).
        vm.startPrank(shareholders);
        opsHat = HATS.createHat(topHat, "Ops", 5, noModule, noModule, true, "");
        HATS.mintHat(opsHat, users.jordan);
        vm.stopPrank();
    }

    /// @dev The payout role (B8 scoping) and Budgets' wiring, one Board batch; then the top budget
    /// (600,000 a year) and Operations (250,000, Ops hat) in a second.
    function _install() internal {
        budgets.setAgreements(makeAddr("agreements"));

        Call[] memory role = new Call[](8);
        role[0] = Call(
            address(companyRoles),
            0,
            abi.encodeCall(
                IRolesExtra.setTransactionUnwrapper,
                (
                    Addresses.MULTI_SEND_CALL_ONLY_141,
                    bytes4(keccak256("multiSend(bytes)")),
                    Addresses.ROLES_MULTISEND_UNWRAPPER
                )
            )
        );
        role[1] = Call(address(companyRoles), 0, abi.encodeCall(IRolesV2.scopeTarget, (PAYOUT_ROLE, address(usdc))));
        role[2] = Call(
            address(companyRoles),
            0,
            abi.encodeCall(
                IRolesV2.scopeFunction,
                (
                    PAYOUT_ROLE,
                    address(usdc),
                    bytes4(keccak256("approve(address,uint256)")),
                    _approveConditions(),
                    IRolesV2.ExecutionOptions.None
                )
            )
        );
        role[3] = Call(address(companyRoles), 0, abi.encodeCall(IRolesV2.scopeTarget, (PAYOUT_ROLE, address(payments))));
        role[4] = Call(
            address(companyRoles),
            0,
            abi.encodeCall(
                IRolesV2.scopeFunction,
                (
                    PAYOUT_ROLE,
                    address(payments),
                    IPayments.send.selector,
                    _sendConditions(),
                    IRolesV2.ExecutionOptions.None
                )
            )
        );
        role[5] = Call(
            address(companyRoles),
            0,
            abi.encodeCall(IRolesV2.setAllowance, (PAYOUT_ALLOWANCE, CEILING, CEILING, CEILING, 365 days, 0))
        );
        bytes32[] memory keys = new bytes32[](1);
        keys[0] = PAYOUT_ROLE;
        bool[] memory member = new bool[](1);
        member[0] = true;
        role[6] = Call(address(companyRoles), 0, abi.encodeCall(IRolesV2.assignRoles, (address(budgets), keys, member)));
        role[7] = Call(address(budgets), 0, abi.encodeCall(IBudgets.configure, (address(companyRoles), PAYOUT_ROLE)));
        _boardBatch(role);

        Call[] memory tree = new Call[](1);
        tree[0] = Call(
            address(budgets), 0, abi.encodeCall(IBudgets.createTopBudget, (address(usdc), 2, 600_000e6, topHat))
        );
        _boardBatch(tree);
        top = budgets.budgetCount();
        tree[0] = Call(address(budgets), 0, abi.encodeCall(IBudgets.createChildBudget, (top, 250_000e6, opsHat)));
        _boardBatch(tree);
        operations = budgets.budgetCount();
    }

    /// @dev (1) B5: a hat wearer's spend travels Budgets -> Roles -> Gate -> Safe and spends the payout
    /// allowance by exactly the amount; a spend Budgets would allow but over the allowance is refused by Roles.
    function test_B5_SpendPaysThroughTheGateAndRolesCapsIt() external {
        _install();
        _assertGateIsOnlyModuleAndGuard();
        uint256 safeBefore = usdc.balanceOf(address(companySafe));
        uint256 aliceBefore = usdc.balanceOf(users.alice);

        vm.prank(users.jordan);
        budgets.spend(operations, users.alice, 4000e6, 0, DOC, keccak256("job 1"));

        assertEq(usdc.balanceOf(users.alice), aliceBefore + 4000e6, "Alice paid");
        assertEq(usdc.balanceOf(address(companySafe)), safeBefore - 4000e6, "the company Safe paid");
        assertEq(usdc.allowance(address(companySafe), address(payments)), 0, "no standing approval");
        (,,, uint128 left,) = IRolesExtra(address(companyRoles)).allowances(PAYOUT_ALLOWANCE);
        assertEq(left, CEILING - 4000e6, "Roles counted the send");

        // Budgets has 246,000 left in Operations, but Roles has 6,000.
        vm.prank(users.jordan);
        vm.expectRevert();
        budgets.spend(operations, users.alice, 6000e6 + 1, 0, DOC, keccak256("job 2"));
        assertEq(budgets.budgetOf(operations).ownSpent, 4000e6, "the refused spend left nothing behind");
        assertEq(usdc.balanceOf(users.alice), aliceBefore + 4000e6, "and paid nothing");
    }

    /// @dev (2) B8: even calling Roles directly as Budgets, the payout role moves money only by `approve`
    /// to Payments and `send` in the enabled token within the allowance.
    function test_B8_PayoutRoleRefusesEverythingElseEvenAsBudgets() external {
        _install();
        vm.startPrank(address(budgets));
        // A plain transfer.
        vm.expectRevert();
        companyRoles.execTransactionWithRole(
            address(usdc),
            0,
            abi.encodeWithSignature("transfer(address,uint256)", users.eve, 1),
            CALL,
            PAYOUT_ROLE,
            true
        );
        // An approval to anyone but Payments.
        vm.expectRevert();
        companyRoles.execTransactionWithRole(
            address(usdc), 0, abi.encodeWithSignature("approve(address,uint256)", users.eve, 1), CALL, PAYOUT_ROLE, true
        );
        // A send in a token the role does not enable.
        IPayments.PaymentItem memory item = _item(address(dai), 1);
        vm.expectRevert();
        companyRoles.execTransactionWithRole(
            address(payments), 0, abi.encodeCall(IPayments.send, (item)), CALL, PAYOUT_ROLE, true
        );
        // A send over the allowance.
        item = _item(address(usdc), CEILING + 1);
        vm.expectRevert();
        companyRoles.execTransactionWithRole(
            address(payments), 0, abi.encodeCall(IPayments.send, (item)), CALL, PAYOUT_ROLE, true
        );
        vm.stopPrank();
        (,,, uint128 left,) = IRolesExtra(address(companyRoles)).allowances(PAYOUT_ALLOWANCE);
        assertEq(left, CEILING, "nothing was counted");
    }

    /// @dev (3) M4 on the real stack: Jordan schedules a supplier payment for the 1st; anyone executes it on
    /// the 1st, once.
    function test_ScheduledPaymentExecutesOnceOnTheFork() external {
        _install();
        uint64 payAt = uint64(block.timestamp + 10 days);
        vm.prank(users.jordan);
        uint256 sid = budgets.schedule(operations, users.bob, 2500e6, 1, payAt, DOC, keccak256("job 3"));
        uint256 bobBefore = usdc.balanceOf(users.bob);

        vm.warp(payAt);
        vm.prank(users.eve);
        budgets.execute(sid);
        assertEq(usdc.balanceOf(users.bob), bobBefore + 2500e6, "Bob paid on the day");

        vm.prank(users.eve);
        vm.expectRevert(abi.encodeWithSelector(IBudgets.NotPending.selector, sid));
        budgets.execute(sid);
        assertEq(usdc.balanceOf(users.bob), bobBefore + 2500e6, "once");
    }

    /// @dev (4) What a spend sent by the company Safe itself does: the payout is a module call nested in a
    /// Safe transaction, which the Gate refuses (`NoReentryAllowed`, R3 Q4 point 3), so the whole Safe
    /// transaction fails and nothing moves. The Board pays through a hat wearer or a scheduled payment.
    function test_SpendSentByTheSafeItselfIsRefusedByTheGate() external {
        _install();
        uint256 safeBefore = usdc.balanceOf(address(companySafe));
        bytes memory data =
            abi.encodeCall(IBudgets.spend, (operations, users.alice, 1000e6, 0, DOC, keccak256("board job")));
        bytes memory sig = _boardApprove(address(budgets), 0, data, CALL);
        vm.expectRevert();
        companySafe.execTransaction(address(budgets), 0, data, CALL, 0, 0, 0, address(0), payable(address(0)), sig);
        assertEq(usdc.balanceOf(address(companySafe)), safeBefore, "nothing moved");
        assertEq(budgets.budgetOf(operations).ownSpent, 0, "nothing spent");
    }

    function _item(address token, uint256 amount) internal view returns (IPayments.PaymentItem memory item) {
        item = IPayments.PaymentItem({
            paymentId: bytes32(0),
            recipient: users.eve,
            token: token,
            amount: amount,
            kind: 0,
            documentHash: DOC,
            jobNonce: keccak256("direct"),
            executor: address(companySafe)
        });
        item.paymentId = payments.paymentId(item);
    }

    function _approveConditions() internal view returns (IRolesV2.ConditionFlat[] memory c) {
        c = new IRolesV2.ConditionFlat[](3);
        c[0] = _cond(0, CALLDATA, MATCHES, "");
        c[1] = _cond(0, STATIC, EQUAL_TO, abi.encode(address(payments)));
        c[2] = _cond(0, STATIC, PASS, "");
    }

    /// @dev send(PaymentItem): the calldata, the item tuple, then its eight fields; the token is fixed and the
    /// amount is within the allowance.
    function _sendConditions() internal view returns (IRolesV2.ConditionFlat[] memory c) {
        c = new IRolesV2.ConditionFlat[](10);
        c[0] = _cond(0, CALLDATA, MATCHES, "");
        c[1] = _cond(0, TUPLE, MATCHES, "");
        for (uint256 i; i < 8; ++i) {
            c[2 + i] = _cond(1, STATIC, PASS, "");
        }
        c[4] = _cond(1, STATIC, EQUAL_TO, abi.encode(address(usdc)));
        c[5] = _cond(1, STATIC, WITHIN_ALLOWANCE, abi.encode(PAYOUT_ALLOWANCE));
    }

    function _cond(
        uint8 parent,
        uint8 paramType,
        uint8 operator,
        bytes memory compValue
    )
        internal
        pure
        returns (IRolesV2.ConditionFlat memory)
    {
        return IRolesV2.ConditionFlat({
            parent: parent,
            paramType: IRolesV2.ParameterType(paramType),
            operator: IRolesV2.Operator(operator),
            compValue: compValue
        });
    }
}
