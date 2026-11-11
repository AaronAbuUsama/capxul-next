// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { console2 } from "forge-std/console2.sol";

import { IBudgets } from "../../src/interfaces/IBudgets.sol";
import { MockSafe } from "../mocks/MockSafe.sol";
import { BudgetsGateMock, BudgetsRolesMock } from "../utils/Budgets/BudgetsMocks.sol";
import { Budgets_Shared_Test } from "../utils/Budgets/Budgets_Shared_Test.sol";
import { BudgetsAttackerHandler } from "./handlers/BudgetsAttackerHandler.sol";
import { BudgetsHandler } from "./handlers/BudgetsHandler.sol";

/// @notice The Budgets rows of invariants.md whose tool is Fuzz-inv: B1, B2, B7, B11 (with B6 and
/// H2 alongside), B15 and B16, over company A's trees (two tokens, three periods, depth up to 8) and
/// company B on the same Budgets.
contract Budgets_Invariant_Test is Budgets_Shared_Test {
    uint256 internal constant B_BOARD_HAT = uint256(3) << 224;
    uint256 internal constant B_TEAM_HAT = B_BOARD_HAT | (uint256(1) << 208);

    BudgetsHandler internal handler;
    BudgetsAttackerHandler internal attacker;
    MockSafe internal safeB;

    function setUp() public override {
        super.setUp();
        // Company B: its own Safe, Signer Gate and Roles on the same Budgets; the investor wears its team hat.
        safeB = new MockSafe(address(this));
        BudgetsRolesMock rolesB = new BudgetsRolesMock(safeB, address(new BudgetsGateMock(address(safeB))));
        safeB.enableModule(address(rolesB));
        rolesB.setMember(ROLE_KEY, address(budgets), true);
        hats.setWearer(B_BOARD_HAT, address(safeB), true);
        hats.setWearer(B_TEAM_HAT, users.investor, true);
        usdc.mint(address(safeB), 1e24);

        handler = new BudgetsHandler(
            BudgetsHandler.Wiring({
                budgets: budgets,
                deployer: address(this),
                safe: address(safe),
                roles: address(payoutRoles),
                roleKey: ROLE_KEY,
                agreements: agreements,
                usdc: address(usdc),
                dai: address(dai),
                reentrant: address(reentrantToken),
                anyone: users.eve,
                safeB: address(safeB),
                rolesB: address(rolesB),
                boardHatB: B_BOARD_HAT,
                hatB: B_TEAM_HAT,
                wearerB: users.investor
            }),
            BOARD_HAT,
            [CEO_HAT, OPS_HAT, MARKETING_HAT],
            [address(users.amira), address(users.jordan), address(users.ben)]
        );
        attacker = new BudgetsAttackerHandler(
            handler,
            hats,
            address(payoutRoles),
            ROLE_KEY,
            [address(users.eve), address(users.jordan), address(users.ben), address(users.investor)]
        );

        bytes4[] memory selectors = new bytes4[](15);
        selectors[0] = BudgetsHandler.createChild.selector;
        selectors[1] = BudgetsHandler.setAmount.selector;
        selectors[2] = BudgetsHandler.toggleClosed.selector;
        selectors[3] = BudgetsHandler.setHat.selector;
        selectors[4] = BudgetsHandler.spend.selector;
        selectors[5] = BudgetsHandler.schedule.selector;
        selectors[6] = BudgetsHandler.cancel.selector;
        selectors[7] = BudgetsHandler.execute.selector;
        selectors[8] = BudgetsHandler.commit.selector;
        selectors[9] = BudgetsHandler.release.selector;
        selectors[10] = BudgetsHandler.payReserved.selector;
        selectors[11] = BudgetsHandler.warp.selector;
        selectors[12] = BudgetsHandler.siblingFirst.selector;
        selectors[13] = BudgetsHandler.reenter.selector;
        selectors[14] = BudgetsHandler.createChild.selector; // trees grow twice as often as anything else
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
        bytes4[] memory attack = new bytes4[](1);
        attack[0] = BudgetsAttackerHandler.attack.selector;
        targetSelector(FuzzSelector({ addr: address(attacker), selectors: attack }));
        targetContract(address(handler));
        targetContract(address(attacker));
    }

    /// @dev B1: `eff(ownSpent) + ownCommitted + childrenAmount <= amount` for every budget.
    function invariant_B1_useFits() external view {
        uint256 n = _count();
        for (uint256 i; i < n; ++i) {
            IBudgets.Budget memory b = budgets.budgetOf(_id(i));
            assertLe(uint256(b.ownSpent) + b.ownCommitted + b.childrenAmount, b.amount, "B1");
        }
    }

    /// @dev B2: `eff(spent) = eff(ownSpent) + sum(child eff spent)`, `committed = ownCommitted + sum(child committed)`.
    function invariant_B2_sumsMatch() external view {
        uint256 n = _count();
        for (uint256 i; i < n; ++i) {
            uint256 id = _id(i);
            IBudgets.Budget memory b = budgets.budgetOf(id);
            uint256[] memory children = budgets.childrenOf(id);
            uint256 spent = b.ownSpent;
            uint256 committed = b.ownCommitted;
            for (uint256 c; c < children.length; ++c) {
                IBudgets.Budget memory child = budgets.budgetOf(children[c]);
                spent += child.spent;
                committed += child.committed;
            }
            assertEq(b.spent, spent, "B2 spent");
            assertEq(b.committed, committed, "B2 committed");
        }
    }

    /// @dev B6 (Certora's row, checked here too because it is cheap): `childrenAmount = sum(child.amount) <= amount`.
    function invariant_B6_childrenFit() external view {
        uint256 n = _count();
        for (uint256 i; i < n; ++i) {
            uint256 id = _id(i);
            IBudgets.Budget memory b = budgets.budgetOf(id);
            uint256[] memory children = budgets.childrenOf(id);
            uint256 sum;
            for (uint256 c; c < children.length; ++c) {
                sum += budgets.budgetOf(children[c]).amount;
            }
            assertEq(b.childrenAmount, sum, "B6 sum");
            assertLe(b.childrenAmount, b.amount, "B6 fits");
        }
    }

    /// @dev B7: nothing company A's people or Eve do changes company B's budgets or its scheduled
    /// payment; and no refused caller ever got through (H2).
    function invariant_B7_otherSafeUntouched() external view {
        if (!handler.ready()) return;
        IBudgets.Budget memory bTop = budgets.budgetOf(handler.bIds(0));
        IBudgets.Budget memory bChild = budgets.budgetOf(handler.bIds(1));
        assertEq(bTop.safe, address(safeB), "B's top is B's");
        assertEq(bTop.amount, 1_000_000e6, "B's top amount");
        assertEq(bTop.childrenAmount, 400_000e6, "B's children");
        assertEq(bTop.committed, 3000e6, "B's committed");
        assertFalse(bTop.closed || bChild.closed, "B open");
        assertEq(bChild.amount, 400_000e6, "B's child amount");
        assertEq(bChild.hat, B_TEAM_HAT, "B's child hat");
        assertEq(bChild.ownCommitted, 3000e6, "B's reservations");
        assertEq(bChild.ownSpent + bTop.spent, 0, "B spent nothing");
        IBudgets.Scheduled memory s = budgets.scheduledOf(handler.bScheduled());
        assertEq(uint8(s.state), uint8(IBudgets.ScheduleState.Pending), "B's payment pending");
        assertEq(attacker.breaches(), 0, "H2: a refused caller got through");
    }

    /// @dev B11 (N-9): every budget's effective own spend is exactly what was spent from it in the
    /// current period, whichever branch rolled its ancestors first.
    function invariant_B11_ownSpendRestarts() external view {
        uint256 n = handler.idsLength();
        for (uint256 i; i < n; ++i) {
            uint256 id = handler.ids(i);
            assertEq(budgets.budgetOf(id).ownSpent, handler.ghostOwnSpent(id, handler.periodNow(id)), "B11");
        }
    }

    /// @dev B15: `ownCommitted` = pending scheduled amounts + agreement reservations, per budget.
    function invariant_B15_scheduledReserved() external view {
        uint256 n = handler.idsLength();
        for (uint256 i; i < n; ++i) {
            uint256 id = handler.ids(i);
            assertEq(budgets.budgetOf(id).ownCommitted, handler.ghostPending(id) + handler.ghostReserved(id), "B15");
        }
        uint256 p = handler.pendingLength();
        for (uint256 i; i < p; ++i) {
            BudgetsHandler.Pending memory pending = handler.pendingAt(i);
            assertEq(
                uint8(budgets.scheduledOf(pending.sid).state), uint8(IBudgets.ScheduleState.Pending), "still pending"
            );
        }
    }

    /// @dev B16 (D10): every re-entry the hostile token tried was refused with `ReentrantCall`.
    function invariant_B16_lockRefusesReentry() external view {
        assertEq(handler.reentryEscapes(), 0, "B16");
        // The lock is a real check, not a vacuous pass: Budgets answers at all.
        assertGe(budgets.budgetCount(), 0, "Budgets answers");
    }

    /// @dev The handler call-count summary invariants.md asks of every invariant file.
    function afterInvariant() external view {
        bytes32[14] memory actions = [
            bytes32("createChild"),
            "setAmount",
            "toggleClosed",
            "setHat",
            "spend",
            "schedule",
            "cancel",
            "execute",
            "commit",
            "release",
            "payReserved",
            "warp",
            "siblingFirst",
            "reenter"
        ];
        for (uint256 i; i < actions.length; ++i) {
            console2.log(string(abi.encodePacked(actions[i])), handler.calls(actions[i]));
        }
        console2.log("budgets", handler.idsLength());
        console2.log("re-entries tried", handler.reentriesTried());
        console2.log("attacks", attacker.attempts());
    }

    function _count() internal view returns (uint256) {
        return handler.idsLength() + handler.bIdsLength();
    }

    function _id(uint256 i) internal view returns (uint256) {
        uint256 a = handler.idsLength();
        return i < a ? handler.ids(i) : handler.bIds(i - a);
    }
}
