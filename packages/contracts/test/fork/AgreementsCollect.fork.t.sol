// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Agreements } from "../../src/money/Agreements.sol";
import { IAgreements } from "../../src/interfaces/IAgreements.sol";
import { MockHats } from "../mocks/MockHats.sol";
import { MockBudgets } from "../utils/Agreements/MockBudgets.sol";
import { Fork_Test } from "./Fork_Test.t.sol";
import { IHatsSignerGate, IRoles } from "./Interfaces.sol";

/// @notice Agreements collections on the real path (invariants A7, A8; spec/agreements.md "D10 lock"): a
/// payee collects, Budgets pays through the Safe's real Zodiac Roles payout role, Roles goes through the
/// real Hats Signer Gate, and the company Safe 1.4.1 pays. Budgets is the `MockBudgets` stand-in (W2's
/// Budgets suite proves its own Roles/MultiSend/Payments calldata, B5, B8); here it calls the real Roles
/// directly, so every refusal below Agreements is a real one. The budget's hat is a real Hats hat.
/// Ports beta `PayrollDepartments.fork.t.sol:468` (one Payment per collection), `:635` and
/// `PayrollDepartmentsEdges.fork.t.sol:350`, `:402` (a refused collection consumes nothing).
contract AgreementsCollect_Fork_Test is Fork_Test {
    bytes32 internal constant PAYOUT_KEY = "capxul.test.payout";
    bytes32 internal constant TERMS = keccak256("Alice's employment terms");
    bytes4 internal constant ROLES_NO_MEMBERSHIP = bytes4(keccak256("NoMembership()"));
    bytes4 internal constant ROLES_MODULE_TX_FAILED = bytes4(keccak256("ModuleTransactionFailed()"));

    Agreements internal agreements;
    MockBudgets internal budgets;
    uint256 internal opsHat;
    uint256 internal operations;

    function _deployProtocol() internal override {
        budgets = new MockBudgets(MockHats(address(HATS)));
        agreements = new Agreements(address(budgets));
        budgets.setAgreements(address(agreements));
        vm.label(address(budgets), "Budgets (stand-in)");
        vm.label(address(agreements), "Agreements");

        // The Shareholders create the Ops hat and give it to Jordan.
        vm.startPrank(shareholders);
        opsHat = HATS.createHat(topHat, "Ops", 5, noModule, noModule, true, "");
        HATS.mintHat(opsHat, users.jordan);
        vm.stopPrank();

        // The Board scopes the payout role to usdc.transfer and gives it to Budgets, in one batch.
        _grantPayoutRole(true);
        operations = budgets.create(
            address(companySafe),
            0,
            opsHat,
            address(usdc),
            2,
            uint128(250_000 * USDC_UNIT),
            address(companyRoles),
            PAYOUT_KEY
        );
    }

    /// @dev A7: two collections are two distinct payments (fresh job nonce, kind 4, the agreement's document
    /// hash), each paid by the company Safe through Roles and the Gate, leaving no standing approval.
    function test_A7_EachCollectionIsADistinctPaymentThroughRolesGateAndSafe() external {
        uint256 id = _stream();
        vm.warp(block.timestamp + 7 days);
        uint256 safeBefore = usdc.balanceOf(address(companySafe));
        uint256 aliceBefore = usdc.balanceOf(users.alice);

        vm.expectEmit(true, false, false, false, address(companySafe));
        emit IHatsSignerGate.ExecutionFromModuleSuccess(address(gate));
        vm.expectEmit(true, false, false, false, address(gate));
        emit IHatsSignerGate.ExecutionFromModuleSuccess(address(companyRoles));
        vm.prank(users.alice);
        agreements.collect(id, uint128(400 * USDC_UNIT));
        vm.prank(users.alice);
        agreements.collect(id, uint128(600 * USDC_UNIT));

        assertEq(usdc.balanceOf(address(companySafe)), safeBefore - 1000 * USDC_UNIT, "the company Safe paid");
        assertEq(usdc.balanceOf(users.alice), aliceBefore + 1000 * USDC_UNIT, "Alice was paid the week");
        assertEq(budgets.payCount(), 2, "two payments");
        MockBudgets.Pay memory first = budgets.payAt(0);
        MockBudgets.Pay memory second = budgets.payAt(1);
        assertEq(first.jobNonce, keccak256(abi.encode(address(agreements), id, uint64(0))), "nonce 0");
        assertEq(second.jobNonce, keccak256(abi.encode(address(agreements), id, uint64(1))), "nonce 1");
        assertTrue(first.paymentId != second.paymentId, "distinct payments");
        assertEq(first.kind, 4, "agreement collection");
        assertEq(second.documentHash, TERMS, "the agreement's document");
        assertEq(usdc.allowance(address(companySafe), address(budgets)), 0, "no standing approval");
        assertEq(agreements.agreementOf(id).collections, 2, "two collections");
    }

    /// @dev A8: Roles refusing (the role revoked) and the Safe's balance falling short each revert the whole
    /// collection: collected, collections and what is owed are unchanged; once both allow it, the same
    /// collection pays with the first job nonce.
    function test_A8_ARefusedCollectionConsumesNothing() external {
        uint256 id = _stream();
        vm.warp(block.timestamp + 7 days);

        _grantPayoutRole(false);
        vm.prank(users.alice);
        vm.expectRevert(ROLES_NO_MEMBERSHIP);
        agreements.collect(id, uint128(500 * USDC_UNIT));
        _assertNothingConsumed(id);
        _grantPayoutRole(true);

        deal(address(usdc), address(companySafe), 100 * USDC_UNIT);
        vm.prank(users.alice);
        vm.expectRevert(ROLES_MODULE_TX_FAILED);
        agreements.collect(id, uint128(500 * USDC_UNIT));
        _assertNothingConsumed(id);
        deal(address(usdc), address(companySafe), 1_000_000 * USDC_UNIT);

        vm.prank(users.alice);
        agreements.collect(id, uint128(500 * USDC_UNIT));
        assertEq(budgets.payAt(0).jobNonce, keccak256(abi.encode(address(agreements), id, uint64(0))), "nonce 0");
    }

    /// @dev Jordan, wearing the real Ops hat, offers Alice 1,000 USDC a week released every second; Alice
    /// accepts at once.
    function _stream() internal returns (uint256 id) {
        vm.prank(users.jordan);
        id = agreements.offer(
            operations, users.alice, uint128(1000 * USDC_UNIT), 0, 0, 0, 1, uint64(block.timestamp + 1 days), TERMS
        );
        vm.prank(users.alice);
        agreements.accept(id, TERMS);
    }

    function _assertNothingConsumed(uint256 id) internal view {
        IAgreements.Agreement memory a = agreements.agreementOf(id);
        assertEq(a.collected, 0, "collected unchanged");
        assertEq(a.collections, 0, "no job nonce used");
        assertEq(agreements.availableOf(id), 1000 * USDC_UNIT, "the week is still owed");
        assertEq(budgets.payCount(), 0, "no payment");
    }

    function _grantPayoutRole(bool on) internal {
        bytes32[] memory keys = new bytes32[](1);
        keys[0] = PAYOUT_KEY;
        bool[] memory member = new bool[](1);
        member[0] = on;
        Call[] memory grant = new Call[](on ? 3 : 1);
        grant[0] = Call(address(companyRoles), 0, abi.encodeCall(IRoles.assignRoles, (address(budgets), keys, member)));
        if (on) {
            grant[1] = Call(address(companyRoles), 0, abi.encodeCall(IRoles.scopeTarget, (PAYOUT_KEY, address(usdc))));
            grant[2] = Call(
                address(companyRoles),
                0,
                abi.encodeCall(IRoles.allowFunction, (PAYOUT_KEY, address(usdc), usdc.transfer.selector, 0))
            );
        }
        _boardBatch(grant);
    }
}
