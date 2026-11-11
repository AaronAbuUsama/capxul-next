// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";

import { Budgets } from "../../src/money/Budgets.sol";
import { IBudgets } from "../../src/interfaces/IBudgets.sol";
import { MockERC20 } from "../mocks/MockERC20.sol";
import { MockHats } from "../mocks/MockHats.sol";
import { MockSafe } from "../mocks/MockSafe.sol";
import { BudgetsGateMock, BudgetsPaymentsMock, BudgetsRolesMock } from "../utils/Budgets/BudgetsMocks.sol";

/// @notice fv/halmos.md `check_B1_leftNeverUnderflows` (invariant B1's `left` lemma), on the real
/// Budgets: for every top amount and every child amount, schedule and commitment that fit in turn,
/// each call succeeds, `left = amount - childrenAmount - ownSpent - ownCommitted` is exactly what the
/// numbers say (no underflow, no wrap), B1 holds, and one unit more than `left` is refused.
/// @dev Vacuity guard (verification-loop.md): every call the check expects to succeed is wrapped in
/// `try ... catch { assert(false); }`, so a reverting stub is a counterexample, never a pass.
contract Budgets_Symbolic is Test {
    uint256 internal constant HAT = uint256(2) << 224;
    uint256 internal constant CHILD_HAT = HAT | (uint256(1) << 208);
    bytes32 internal constant KEY = keccak256("capxul.v4.payout");
    bytes32 internal constant DOC = keccak256("doc");

    Budgets internal budgets;
    MockSafe internal safe;
    BudgetsRolesMock internal roles;
    MockERC20 internal token;
    address internal agreements = address(0xA9);

    function setUp() public {
        vm.warp(1_767_225_600); // 1 January 2026
        token = new MockERC20("USD Coin", "USDC", 6);
        safe = new MockSafe(address(this));
        MockHats hats = new MockHats();
        BudgetsPaymentsMock payments = new BudgetsPaymentsMock();
        budgets = new Budgets(address(payments), address(hats));
        roles = new BudgetsRolesMock(safe, address(new BudgetsGateMock(address(safe))));
        roles.setMember(KEY, address(budgets), true);
        safe.enableModule(address(roles));
    }

    function check_B1_leftNeverUnderflows(
        uint128 amount,
        uint128 child,
        uint128 scheduled,
        uint128 committed
    )
        external
    {
        vm.assume(child <= amount);
        vm.assume(scheduled <= amount - child);
        vm.assume(committed <= amount - child - scheduled);

        // The one concrete wiring every path needs: it must succeed.
        try budgets.setAgreements(agreements) { }
        catch {
            assert(false);
        }
        vm.prank(address(safe));
        try budgets.configure(address(roles), KEY) { }
        catch {
            assert(false);
        }

        vm.prank(address(safe));
        uint256 top;
        try budgets.createTopBudget(address(token), 2, amount, HAT) returns (uint256 id) {
            top = id;
        } catch {
            assert(false);
        }
        if (child > 0) {
            vm.prank(address(safe));
            try budgets.createChildBudget(top, child, CHILD_HAT) { }
            catch {
                assert(false);
            }
        }
        if (scheduled > 0) {
            vm.prank(address(safe));
            try budgets.schedule(
                top, address(0xB0B), scheduled, 0, uint64(block.timestamp + 1), DOC, keccak256("job")
            ) { }
            catch {
                assert(false);
            }
        }
        if (committed > 0) {
            vm.prank(agreements);
            try budgets.commit(top, committed) { }
            catch {
                assert(false);
            }
        }

        uint128 left = budgets.leftOf(top);
        IBudgets.Budget memory b = budgets.budgetOf(top);
        assert(left == amount - child - scheduled - committed);
        assert(b.childrenAmount == child);
        assert(b.ownCommitted == scheduled + committed);
        assert(uint256(b.ownSpent) + b.ownCommitted + b.childrenAmount <= b.amount);

        // One more unit than is left is refused, whatever the numbers.
        if (left < type(uint128).max) {
            vm.prank(agreements);
            try budgets.commit(top, left + 1) {
                assert(false);
            } catch { }
        }
    }
}
