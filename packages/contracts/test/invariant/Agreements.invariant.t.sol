// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { console2 } from "forge-std/console2.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IAgreements } from "../../src/interfaces/IAgreements.sol";
import { CalendarModel } from "../utils/Agreements/CalendarModel.sol";
import { Agreements_Unit_Shared } from "../utils/Agreements/Agreements_Unit_Shared.sol";
import { AgreementsHandler } from "./handlers/AgreementsHandler.sol";

/// @notice Agreements' invariants over random sequences of offers (single, in bulk, twinned, defective),
/// acceptances (by the payee, by Eve, with the wrong terms, too late), withdrawals, raises, lowerings,
/// cancelled lowerings, pauses, resumes, ends, collections (some over the release, some on a re-entering
/// token, some refused by Roles or the Safe's balance), settles, budget cuts and closures, a hat wearer's
/// standing lapsing, and time jumps across month starts, over four budgets of two Safes. Ports beta
/// `PayrollDepartmentsInvariantForkTest` (`packages/contracts/test/fork/PayrollDepartmentsInvariant.fork.t.sol:487-684`).
contract Agreements_Invariant_Test is Agreements_Unit_Shared {
    AgreementsHandler internal handler;
    uint256[4] internal budgetList;

    function setUp() public override {
        super.setUp();
        // Enough money that only a squeezed allowance or a deliberately low balance refuses a collection.
        deal(address(usdc), address(safe), 1e18);
        deal(address(reentrantToken), address(safe), 1e18);
        deal(address(usdc), otherSafe, 1e18);
        budgetList = [operations, monthlyBudget, reentrantBudget, otherBudget];
        handler = new AgreementsHandler(
            agreements,
            budgets,
            hats,
            roles,
            reentrantToken,
            [address(safe), users.amira, users.jordan, users.ben, otherSafe, users.eve],
            budgetList,
            operating,
            OPS_HAT,
            PAYOUT_KEY
        );
        vm.label(address(handler), "AgreementsHandler");
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](14);
        selectors[0] = AgreementsHandler.offer.selector;
        selectors[1] = AgreementsHandler.offerMany.selector;
        selectors[2] = AgreementsHandler.accept.selector;
        selectors[3] = AgreementsHandler.withdrawOffer.selector;
        selectors[4] = AgreementsHandler.raise.selector;
        selectors[5] = AgreementsHandler.lower.selector;
        selectors[6] = AgreementsHandler.cancelChange.selector;
        selectors[7] = AgreementsHandler.pause.selector;
        selectors[8] = AgreementsHandler.resume.selector;
        selectors[9] = AgreementsHandler.end.selector;
        selectors[10] = AgreementsHandler.collect.selector;
        selectors[11] = AgreementsHandler.settle.selector;
        selectors[12] = AgreementsHandler.budgetSide.selector;
        selectors[13] = AgreementsHandler.warp.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
    }

    // ------------------------------------------------------------------ A12, B7

    /// @dev A12: no wrong acceptance and no wrong refusal against the independent model.
    function invariant_A12_acceptsExactlyWhatTheRulesAllow() public view {
        _countMatches();
        assertEq(handler.wrongAcceptances(), 0, "accepted a call the rules refuse");
        assertEq(handler.wrongRefusals(), 0, "refused a call the rules allow");
    }

    /// @dev B7: no Board or hat wearer of one Safe changed the other Safe's agreements.
    function invariant_B7_otherSafeUntouched() public view {
        _countMatches();
        assertEq(handler.crossSafeAccepted(), 0, "one Safe's actor changed the other Safe's agreements");
    }

    // ------------------------------------------------------------------ A2, B15

    /// @dev A2 (restated, R2 4.4) and the agreement part of B15: each budget's `ownCommitted` is the sum of
    /// the current reservations of its open agreements, due but unsettled ones included; it equals the
    /// model's figure; and the open list is what the model says.
    function invariant_A2_committedIsTheOpenReservations() public view {
        _countMatches();
        uint256 n = handler.idCount();
        for (uint256 b; b < 4; ++b) {
            uint256 sum;
            for (uint256 i; i < n; ++i) {
                uint256 id = handler.ids(i);
                IAgreements.Agreement memory a = agreements.agreementOf(id);
                if (a.budgetId == budgetList[b] && !a.closed) sum += a.reserved;
            }
            uint128 committed = budgets.ownCommitted(budgetList[b]);
            assertEq(committed, sum, "ownCommitted is the open agreements' reservations");
            assertEq(committed, handler.committedOf(b), "and the model's figure");
            assertEq(agreements.openOf(budgetList[b]).length, handler.listedOf(b), "the open list");
            assertLe(agreements.openOf(budgetList[b]).length, 64, "at most 64 open");
        }
    }

    // ------------------------------------------------------------------ A1, A4, A5

    /// @dev A1: `collected * SCALE <= releasedScaled <= earnedScaled` for every agreement.
    function invariant_A1_collectedWithinReleasedWithinEarned() public view {
        _countMatches();
        uint256 n = handler.idCount();
        for (uint256 i; i < n; ++i) {
            IAgreements.Agreement memory a = agreements.agreementOf(handler.ids(i));
            assertLe(uint256(a.collected) * SCALE, a.releasedScaled, "collected within released");
            assertLe(a.releasedScaled, a.earnedScaled, "released within earned");
        }
    }

    /// @dev A1 ("earned matches the Calendar over the rate history") and A5 (two-sided): available and
    /// earned pay equal the model's to the unit; collected plus available is never above the exact
    /// released entitlement and short of it by under one unit; each payee holds exactly what they collected.
    function invariant_A5_payIsTheExactEntitlementRoundedDown() public view {
        _countMatches();
        uint256 n = handler.idCount();
        for (uint256 i; i < n; ++i) {
            uint256 id = handler.ids(i);
            assertEq(agreements.availableOf(id), handler.availableOf(id), "released pay");
            assertEq(agreements.earnedOf(id), handler.earnedOf(id), "earned pay");
            (uint256 earned, uint256 released) = handler.entitlementOf(id);
            IAgreements.Agreement memory a = agreements.agreementOf(id);
            uint256 out = (uint256(a.collected) + agreements.availableOf(id)) * SCALE;
            assertLe(out, released, "never more than the released entitlement");
            assertLt(released - out, SCALE, "short of it by under one unit");
            uint256 all = (uint256(a.collected) + agreements.earnedOf(id)) * SCALE;
            assertLe(all, earned, "never more than the earned entitlement");
            assertLt(earned - all, SCALE, "short of it by under one unit");
            assertEq(IERC20(a.token).balanceOf(a.payee), a.collected, "the payee holds what they collected");
            assertEq(a.collections, handler.modelOf(id).collections, "one payment per collection");
        }
    }

    /// @dev A4: nothing accrues before acceptance.
    function invariant_A4_nothingAccruesBeforeAcceptance() public view {
        _countMatches();
        uint256 n = handler.idCount();
        for (uint256 i; i < n; ++i) {
            uint256 id = handler.ids(i);
            IAgreements.Agreement memory a = agreements.agreementOf(id);
            assertEq(a.accepted, handler.modelOf(id).accepted, "accepted as the model says");
            if (a.accepted) continue;
            assertEq(a.earnedScaled, 0, "no earned pay stored");
            assertEq(agreements.earnedOf(id), 0, "no earned pay shown");
        }
    }

    // ------------------------------------------------------------------ A3, A6, A8, A9, A11

    /// @dev A3: earned pay of a paused or ended agreement never moved across a time jump.
    function invariant_A3_nothingAccruesWhilePausedOrEnded() public view {
        _countMatches();
        assertEq(handler.a3Violations(), 0, "pay accrued while paused or after the end");
    }

    /// @dev A6: an agreement collected at random times pays exactly what its never-collected twin owes.
    function invariant_A6_payIsPathIndependent() public view {
        _countMatches();
        uint256 n = handler.idCount();
        for (uint256 i; i < n; ++i) {
            uint256 id = handler.ids(i);
            uint256 twin = handler.modelOf(id).twin;
            if (twin == 0) continue;
            uint128 collected = agreements.agreementOf(id).collected;
            assertEq(collected + agreements.availableOf(id), agreements.availableOf(twin), "released, both paths");
            assertEq(collected + agreements.earnedOf(id), agreements.earnedOf(twin), "earned, both paths");
        }
    }

    /// @dev A8: a refused collection left the agreement's record and what it owes unchanged.
    function invariant_A8_refusedCollectionConsumesNothing() public view {
        _countMatches();
        assertEq(handler.a8Violations(), 0, "a refused collection changed the agreement");
    }

    /// @dev A9: a short fixed term never releases more than its reservation, and no reservation is above
    /// its period figure.
    function invariant_A9_fixedTermWithinReservation() public view {
        _countMatches();
        uint256 n = handler.idCount();
        for (uint256 i; i < n; ++i) {
            uint256 id = handler.ids(i);
            AgreementsHandler.M memory m = handler.modelOf(id);
            IAgreements.Agreement memory a = agreements.agreementOf(id);
            if (!a.closed) assertLe(a.reserved, handler.figureOf(id), "reservation within the period figure");
            if (!m.fixedTerm || m.reservedAtOffer >= CalendarModel.periodFigure(m.rate, m.period, _periodOf(m.budget)))
            {
                continue;
            }
            assertLe(uint256(a.collected) + agreements.availableOf(id), m.reservedAtOffer, "pays within it");
        }
    }

    /// @dev A11: every re-entry during a collection was refused with `ReentrantCall`.
    function invariant_A11_reentryRefused() public view {
        _countMatches();
        assertEq(handler.a11Violations(), 0, "a re-entering token got a call through");
    }

    /// @dev Print the handler's call counts after every run. The deterministic A12 test checks that the
    /// handler reaches accepted and refused outcomes; a random run can close Operating before any offer.
    function afterInvariant() external view {
        for (uint256 i; i < 11; ++i) {
            bytes32 fn = handler.fns(i);
            console2.log(string(abi.encodePacked(fn)), handler.calls(fn), handler.accepted(fn), handler.refused(fn));
        }
    }

    /// @dev A12's "both counts nonzero for every function", made deterministic: one scripted sequence through
    /// the handler in which every function is both accepted and refused (settle, open to anyone, only
    /// accepted), with no wrong outcome.
    function test_A12_HandlerReachesEveryOutcome() external {
        // Jordan offers 3,000 a month from Operations, streamed; Alice-like payee accepts at once.
        handler.offer(2, 0, 3_000_000_001, 0, 3 days + 1, 2);
        handler.offer(20, 0, 3_000_000_001, 0, 3 days + 1, 2); // seed 20 is Eve: refused
        handler.offer(2, 0, 3_000_000_004, 0, 3 days + 1, 2); // left unaccepted
        handler.accept(0, 0, false); // Eve accepts: refused
        handler.withdrawOffer(1, 2); // the standing offer: withdrawn
        handler.withdrawOffer(0, 2); // accepted: refused
        handler.raise(0, 2, 100);
        handler.raise(0, 20, 100); // seed 20 is Eve: refused
        handler.lower(0, 2, 1000e6, 10 days);
        handler.lower(0, 2, 1000e6, 10 days); // already pending: refused
        handler.cancelChange(0, 2);
        handler.cancelChange(0, 2); // nothing pending: refused
        handler.pause(0, 2);
        handler.pause(0, 2); // already paused: refused
        handler.resume(0, 2);
        handler.resume(0, 2); // not paused: refused
        handler.end(0, 2, 20 days);
        handler.end(0, 2, 30 days); // not earlier: refused
        handler.warp(10 days + 1);
        handler.collect(0, 50, 1);
        handler.collect(0, 101, 1); // one unit over: refused
        handler.settle(0, 5);
        for (uint256 i; i < 11; ++i) {
            bytes32 fn = handler.fns(i);
            assertGt(handler.accepted(fn), 0, string(abi.encodePacked("accepted: ", fn)));
            if (fn != "settle") assertGt(handler.refused(fn), 0, string(abi.encodePacked("refused: ", fn)));
        }
        invariant_A12_acceptsExactlyWhatTheRulesAllow();
    }

    /// @dev A random sequence can close Operating before an offer; the refusal must match the model.
    function test_A12_OperatingClosedBeforeOffer() external {
        handler.budgetSide(254, 23, 137_129_988_335_788_290);
        handler.offer(2, 0, 3_000_000_001, 0, 3 days + 1, 2);
        assertEq(handler.accepted("offer"), 0);
        assertGt(handler.refused("offer"), 0);
        invariant_A12_acceptsExactlyWhatTheRulesAllow();
        this.afterInvariant();
    }

    /// @dev Every invariant first checks that the contract counted exactly the offers the model saw succeed.
    /// A random sequence may have an empty history; test_A12_HandlerReachesEveryOutcome checks reachability.
    function _countMatches() internal view {
        assertEq(agreements.agreementCount(), handler.idCount(), "agreementCount is the offers that succeeded");
    }

    function _periodOf(uint256 b) internal view returns (uint8) {
        return budgets.budgetOf(budgetList[b]).period;
    }
}
