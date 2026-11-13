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

/// @notice The real company with Budgets installed on it (spec/budgets.md "Paying"): Roles 2.1's payout role scoped
/// as `payroll-payout-role.ts` scopes it, Budgets wired to it, a top budget and Operations under the Ops hat, which Jordan
/// wears (real Hats). Shared by the Budgets payout and department escrow fork tests.
/// @dev Payments is the hermetic stand-in until W1's Payments is deployed in Fork_Test's install.
abstract contract BudgetsFork_Test is Fork_Test {
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

    function setUp() public virtual override {
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
