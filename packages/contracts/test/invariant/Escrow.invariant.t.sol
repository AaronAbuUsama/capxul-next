// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { console2 } from "forge-std/console2.sol";

import { IEscrow } from "../../src/interfaces/IEscrow.sol";
import { IEscrowFactory } from "../../src/interfaces/IEscrowFactory.sol";

import { Escrow_Test } from "../utils/Escrow/Escrow_Test.sol";
import { OwnerSafeMock } from "../utils/Escrow/OwnerSafeMock.sol";
import { EscrowHandler } from "./handlers/EscrowHandler.sol";
import { EscrowHandlerBase } from "./handlers/EscrowHandlerBase.sol";

/// @notice The general escrow's properties G1 to G11 (docs/design/escrow.md, "Its properties") over escrows of
/// every shape: invoices, a mailbox's claim escrows, a department's (authority and budget id), an exit claim
/// (`ownerTakesSurplus`), owners with no bootstrap owner, and fresh escrows with random terms from the factory.
/// The handler checks each call against its own model of the spec; these invariants read its breach flags and
/// the value ghosts.
contract Escrow_Invariant_Test is Escrow_Test {
    EscrowHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new EscrowHandler(
            IEscrowFactory(address(factory)),
            payments,
            usdc,
            authority,
            sender,
            companiesHouse,
            EscrowHandlerBase.Actors({
                eve: users.eve, alice: users.alice, bob: users.bob, jordan: users.jordan, ben: users.ben
            })
        );
        // Six shapes, each with its own owner Safe; the claim escrows' owners start unclaimed.
        for (uint256 i; i < 6; ++i) {
            bool ownerCollects = i >= 2;
            OwnerSafeMock o = _ownerSafe(ownerCollects ? companiesHouse : users.alice);
            IEscrow.Terms memory terms = _terms(address(o), ownerCollects ? OWNER_COLLECTS : AMOUNT_REACHED);
            terms.jobNonce = bytes32(i + 1);
            if (i == 1 || i == 3) (terms.authority, terms.authorityKey) = (address(authority), BUDGET_ID);
            if (i == 4) terms.ownerTakesSurplus = true; // an exit claim
            if (i == 5) terms.bootstrapOwner = address(0); // the owner can act from the start
            handler.add(_escrow(terms), o);
        }
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](12);
        selectors[0] = EscrowHandler.deposit.selector;
        selectors[1] = EscrowHandler.donate.selector;
        selectors[2] = EscrowHandler.payout.selector;
        selectors[3] = EscrowHandler.collect.selector;
        selectors[4] = EscrowHandler.refund.selector;
        selectors[5] = EscrowHandler.claim.selector;
        selectors[6] = EscrowHandler.addOwner.selector;
        selectors[7] = EscrowHandler.setAnswer.selector;
        selectors[8] = EscrowHandler.moveHat.selector;
        selectors[9] = EscrowHandler.setAuthorityAnswer.selector;
        selectors[10] = EscrowHandler.payDirectly.selector;
        selectors[11] = EscrowHandler.deployFresh.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
    }

    /// @dev G1, G2: the address is known first, the deploy is idempotent, early money stays and nothing moves.
    function invariant_G1_G2_counterfactual() public view {
        assertFalse(handler.predictionWrong(), "deploy differs from predictAddress, or a second deploy differs");
        assertFalse(handler.paymentIdPredictionWrong(), "predictPaymentId differs from paymentId");
        assertFalse(handler.earlyMoneyLostOrMoved(), "money sent before the deploy was lost or moved");
    }

    /// @dev G3: the token leaves only to the owner or the sender, and every unit is accounted for.
    function invariant_G3_twoWaysOut() public view {
        assertFalse(handler.paidSomeoneElse(), "a call moved tokens to someone other than owner or sender");
        assertFalse(handler.refundPaidTheWrongSide(), "a refund paid someone other than the sender");
        for (uint256 i; i < handler.escrowCount(); ++i) {
            IEscrow escrow = handler.escrows(i);
            (uint256 totalIn, uint256 toSender, uint256 toOwner,,) = handler.ghost(escrow);
            assertEq(usdc.balanceOf(address(escrow)) + toSender + toOwner, totalIn, "value conserved");
        }
        assertEq(usdc.balanceOf(address(payments)), 0, "Payments holds nothing");
    }

    /// @dev G4: only the owner collects, and an owner that can act is never refused while open and funded.
    function invariant_G4_ownerCollectsAnyTime() public view {
        assertFalse(handler.collectByNonOwner(), "collect succeeded for someone other than the owner");
        assertFalse(handler.ownerCollectRefused(), "an owner who could act was refused an open, funded escrow");
        assertFalse(handler.executorBypassed(), "an owner-collects id was sent by someone but its escrow");
    }

    /// @dev G5, G11: the owner is paid exactly `amount` (with the surplus where it takes it), and only once met.
    function invariant_G5_G11_paidOnlyWhenMetAndExact() public view {
        assertFalse(handler.paidWithoutConditionOrInexact(), "paid before the condition, or not exactly amount");
        assertFalse(handler.surplusMisrouted(), "the surplus went the wrong way for ownerTakesSurplus");
        for (uint256 i; i < handler.escrowCount(); ++i) {
            IEscrow escrow = handler.escrows(i);
            if (escrow.condition() != OWNER_COLLECTS) continue;
            assertEq(escrow.conditionMet(), handler.modelCanAct(escrow, handler.owners(i)), "D11 condition");
        }
    }

    /// @dev G6, G9: the sender or whoever the authority admits now may refund; nobody else ever can.
    function invariant_G6_G9_senderOrAuthorityTakesBack() public view {
        assertFalse(handler.refundByUnadmitted(), "a refund succeeded for a caller the authority does not admit");
        assertFalse(handler.admittedRefundRefused(), "an admitted caller was refused an open refundable escrow");
        assertFalse(handler.canRefundDisagrees(), "canRefund differs from the model");
        for (uint256 i; i < handler.escrowCount(); ++i) {
            IEscrow escrow = handler.escrows(i);
            assertTrue(escrow.canRefund(sender), "the sender can always refund");
            assertEq(escrow.canRefund(handler.formerWearer()), handler.modelAdmitted(escrow, handler.formerWearer()));
            assertEq(escrow.canRefund(handler.wearer()), handler.modelAdmitted(escrow, handler.wearer()));
        }
    }

    /// @dev G7: one end. At most one payout or collect, nothing after a close, and the state leaves Open once.
    function invariant_G7_oneEnd() public view {
        assertFalse(handler.settledAfterClose(), "payout or collect after Paid or Refunded");
        assertFalse(handler.reopenedOrClosedTwice(), "the state left Open twice, or went back");
        for (uint256 i; i < handler.escrowCount(); ++i) {
            (,,, uint256 settlements, uint256 closings) = handler.ghost(handler.escrows(i));
            assertLe(settlements, 1, "at most one payment to the owner");
            assertLe(closings, 1, "at most one close");
            if (closings == 0) assertEq(_state(handler.escrows(i)), uint256(IEscrow.State.Open), "open until closed");
        }
    }

    /// @dev G8: every payout, collect and refund left the escrow empty.
    function invariant_G8_emptyAfterEachCall() public view {
        assertFalse(handler.escrowLeftHoldingToken(), "an escrow kept tokens after payout, collect or refund");
    }

    /// @dev G11: an invoice that holds its amount is never refunded.
    function invariant_G11_invoiceKeepsItsClaim() public view {
        assertFalse(handler.invoiceRefundedWhileHeld(), "invoice refunded while it held the amount");
    }

    /// @dev The call-count summary (a row no handler reaches is a gap, not a pass).
    function afterInvariant() external view {
        console2.log("escrows", handler.escrowCount());
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
        console2.log("moveHat", handler.calls(EscrowHandler.moveHat.selector));
        console2.log("setAuthorityAnswer", handler.calls(EscrowHandler.setAuthorityAnswer.selector));
        console2.log("payDirectly", handler.calls(EscrowHandler.payDirectly.selector));
        console2.log("deployFresh", handler.calls(EscrowHandler.deployFresh.selector));
    }
}
