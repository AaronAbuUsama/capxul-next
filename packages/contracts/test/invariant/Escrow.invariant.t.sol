// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { console2 } from "forge-std/console2.sol";

import { IEscrow } from "../../src/interfaces/IEscrow.sol";
import { IEscrowFactory } from "../../src/interfaces/IEscrowFactory.sol";

import { Escrow_Test } from "../utils/Escrow/Escrow_Test.sol";
import { PayeeSafeMock } from "../utils/Escrow/PayeeSafeMock.sol";
import { EscrowHandler } from "./handlers/EscrowHandler.sol";

/// @notice Invariants S1 to S9 (invariants.md, "Money: Escrow and EscrowFactory") over escrows of both
/// conditions, deployed through the factory. Ports beta `CapxulEscrowInvariant.t.sol:44-56` (value
/// conservation, nothing before the condition, at most one payout) and extends it to the claim condition,
/// D11 and D12.
contract Escrow_Invariant_Test is Escrow_Test {
    EscrowHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new EscrowHandler(
            IEscrowFactory(address(factory)), payments, usdc, owner, companiesHouse, users.eve, users.alice, users.bob
        );
        // Two invoice and two claim escrows, each with its own payee Safe; claim payees start unclaimed.
        // They come from the Escrow constructor; the factory is driven by `deployFresh` (S3, S6).
        for (uint256 i; i < 4; ++i) {
            bool claim = i >= 2;
            PayeeSafeMock payee = _payee(claim ? companiesHouse : users.alice);
            IEscrow.Terms memory terms = _terms(address(payee), claim ? CLAIM : INVOICE);
            terms.jobNonce = bytes32(i + 1);
            handler.add(_escrow(terms), payee);
        }
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](10);
        selectors[0] = EscrowHandler.deposit.selector;
        selectors[1] = EscrowHandler.donate.selector;
        selectors[2] = EscrowHandler.payout.selector;
        selectors[3] = EscrowHandler.collect.selector;
        selectors[4] = EscrowHandler.refund.selector;
        selectors[5] = EscrowHandler.claim.selector;
        selectors[6] = EscrowHandler.addOwner.selector;
        selectors[7] = EscrowHandler.setAnswer.selector;
        selectors[8] = EscrowHandler.payDirectly.selector;
        selectors[9] = EscrowHandler.deployFresh.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
    }

    function invariant_S1_settlesOnce() public view {
        for (uint256 i; i < handler.escrowCount(); ++i) {
            (,,, uint256 settlements) = handler.ghost(handler.escrows(i));
            assertLe(settlements, 1, "at most one payout or collect");
        }
        assertFalse(handler.settledTwiceOrAfterClose(), "payout or collect after Paid or Refunded");
        assertFalse(handler.refundPaidSomeoneElse(), "refund sent to someone but the owner");
        assertFalse(handler.refundByNonOwner(), "refund by someone but the owner");
    }

    function invariant_S2_emptyAfterEachCall() public view {
        assertFalse(handler.escrowLeftHoldingToken(), "an escrow kept tokens after payout, collect or refund");
    }

    function invariant_S3_predictedAddress() public view {
        assertFalse(handler.predictionWrong(), "deploy differs from predictAddress");
    }

    function invariant_S4_valueGoesOnlyToOwnerOrPayee() public view {
        for (uint256 i; i < handler.escrowCount(); ++i) {
            IEscrow escrow = handler.escrows(i);
            (uint256 totalIn, uint256 toOwner, uint256 toPayee,) = handler.ghost(escrow);
            assertEq(usdc.balanceOf(address(escrow)) + toOwner + toPayee, totalIn, "value conserved");
        }
        assertEq(usdc.balanceOf(address(payments)), 0, "Payments holds nothing (P2)");
    }

    function invariant_S5_nothingBeforeConditionAndExact() public view {
        assertFalse(handler.paidBeforeConditionOrInexact(), "paid before the condition, or not exactly amount");
    }

    function invariant_S6_predictedPaymentId() public view {
        assertFalse(handler.paymentIdPredictionWrong(), "predictPaymentId differs from paymentId");
        assertFalse(handler.executorBypassed(), "a claim id was sent by someone but its escrow");
    }

    function invariant_S7_noInvoiceRefundOnceHeld() public view {
        assertFalse(handler.invoiceRefundedWhileHeld(), "invoice refunded while it held the amount");
    }

    function invariant_S8_claimConditionFailsClosed() public view {
        for (uint256 i; i < handler.escrowCount(); ++i) {
            IEscrow escrow = handler.escrows(i);
            if (escrow.condition() != CLAIM) continue;
            assertEq(escrow.conditionMet(), handler.modelClaimed(handler.payees(i)), "D11 condition");
        }
    }

    function invariant_S9_openClaimRefundable() public view {
        assertFalse(handler.openClaimRefundRefused(), "the payer could not refund an open claim escrow");
    }

    /// @dev The call-count summary (invariants.md: a row no handler reaches is a gap, not a pass).
    function afterInvariant() external view {
        console2.log("deposit", handler.calls(EscrowHandler.deposit.selector));
        console2.log("donate", handler.calls(EscrowHandler.donate.selector));
        console2.log("payout", handler.calls(EscrowHandler.payout.selector));
        console2.log("payout succeeded", handler.successes(EscrowHandler.payout.selector));
        console2.log("collect", handler.calls(EscrowHandler.collect.selector));
        console2.log("collect succeeded", handler.successes(EscrowHandler.collect.selector));
        console2.log("refund", handler.calls(EscrowHandler.refund.selector));
        console2.log("refund succeeded", handler.successes(EscrowHandler.refund.selector));
        console2.log("claim", handler.calls(EscrowHandler.claim.selector));
        console2.log("addOwner", handler.calls(EscrowHandler.addOwner.selector));
        console2.log("setAnswer", handler.calls(EscrowHandler.setAnswer.selector));
        console2.log("payDirectly", handler.calls(EscrowHandler.payDirectly.selector));
        console2.log("deployFresh", handler.calls(EscrowHandler.deployFresh.selector));
    }
}
