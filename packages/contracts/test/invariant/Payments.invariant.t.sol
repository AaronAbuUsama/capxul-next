// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { console2 } from "forge-std/console2.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { Payments_Test } from "../utils/Payments/Payments_Test.sol";
import { PaymentsAttackerHandler } from "./handlers/PaymentsAttackerHandler.sol";
import { PaymentsDonorHandler } from "./handlers/PaymentsDonorHandler.sol";
import { PaymentsHandler } from "./handlers/PaymentsHandler.sol";

/// @notice Invariants P1, P2, P3, P5, P6 and P8 (invariants.md, "Money: Payments") over three handlers:
/// the honest payers (the Board's Safe and the hat wearers Amira and Jordan) paying Alice, Bob and the
/// investor in every kind of token; Eve the attacker; and Ben, who donates straight to Payments.
contract Payments_Invariant_Test is Payments_Test {
    PaymentsHandler internal handler;
    PaymentsAttackerHandler internal attacker;
    PaymentsDonorHandler internal donor;

    function setUp() public override {
        super.setUp();
        // The Board's Safe holds every token, as a company treasury would.
        usdt.mint(address(safe), 1_000_000 * USDC_UNIT);
        dai.mint(address(safe), 1_000_000 ether);
        feeToken.mint(address(safe), 1_000_000 * USDC_UNIT);
        rebasingToken.mint(address(safe), 1_000_000 * USDC_UNIT);
        falseToken.mint(address(safe), 1_000_000 * USDC_UNIT);
        reentrantToken.mint(address(safe), 1_000_000 * USDC_UNIT);

        address[] memory payers = new address[](3);
        payers[0] = address(safe);
        payers[1] = users.amira;
        payers[2] = users.jordan;
        address[] memory payees = new address[](3);
        payees[0] = users.alice;
        payees[1] = users.bob;
        payees[2] = users.investor;
        address[] memory exact = new address[](3);
        exact[0] = address(usdc);
        exact[1] = address(dai);
        exact[2] = address(usdt);
        handler = new PaymentsHandler(
            payments, payers, payees, exact, feeToken, rebasingToken, address(falseToken), reentrantToken
        );
        attacker = new PaymentsAttackerHandler(payments, handler, users.eve, address(usdc));
        address[] memory donatable = new address[](4);
        donatable[0] = address(usdc);
        donatable[1] = address(dai);
        donatable[2] = address(usdt);
        donatable[3] = address(feeToken);
        donor = new PaymentsDonorHandler(address(payments), users.ben, donatable);

        targetContract(address(handler));
        targetContract(address(attacker));
        targetContract(address(donor));
        vm.label(address(handler), "PaymentsHandler");
        vm.label(address(attacker), "Eve (attacker handler)");
        vm.label(address(donor), "Ben (donor handler)");
    }

    /// @dev P1: every actor's balance of every exact token is what the paid amounts say, to the unit.
    function invariant_P1_exactTransfer() external view {
        address[] memory tokens = handler.exactTokenList();
        address[] memory actors = handler.actors();
        for (uint256 t; t < tokens.length; ++t) {
            for (uint256 a; a < actors.length; ++a) {
                assertEq(IERC20(tokens[t]).balanceOf(actors[a]), handler.expectedBalance(tokens[t], actors[a]), "P1");
            }
        }
    }

    /// @dev P2 (restated): Payments' own balance of each token is exactly what was donated to it.
    function invariant_P2_ownBalanceUnchanged() external view {
        address[5] memory tokens =
            [address(usdc), address(dai), address(usdt), address(feeToken), address(reentrantToken)];
        for (uint256 t; t < tokens.length; ++t) {
            assertEq(IERC20(tokens[t]).balanceOf(address(payments)), donor.donated(tokens[t]), "P2");
        }
        assertEq(rebasingToken.sharesOf(address(payments)), 0, "P2: rebasing");
        assertEq(falseToken.balanceOf(address(payments)), 0, "P2: false-returning");
    }

    /// @dev P3: every consumed id stays paid (paid never goes from true to false).
    function invariant_P3_paidOnlyGrows() external view {
        uint256 count = handler.consumedCount();
        for (uint256 i; i < count; ++i) {
            assertTrue(payments.paid(handler.consumed(i)), "P3");
        }
    }

    /// @dev P3, P4, P5, P7: Eve never had a send accepted.
    function invariant_P5_eveNeverWins() external view {
        assertFalse(attacker.eveWon(), "P5");
    }

    /// @dev P6: no refused send or batch consumed an id.
    function invariant_P6_revertConsumesNothing() external view {
        uint256 count = handler.refusedCount();
        for (uint256 i; i < count; ++i) {
            assertFalse(payments.paid(handler.refused(i)), "P6");
        }
    }

    /// @dev P8: every re-entry was refused with ReentrantCall.
    function invariant_P8_reentryReverts() external view {
        assertEq(handler.reentryRefusals(), handler.reentryAttempts(), "P8");
    }

    /// @dev The call-count summary (invariants.md: a row no handler reaches is a gap, not a pass).
    function afterInvariant() external view {
        console2.log("send", handler.calls(PaymentsHandler.send.selector));
        console2.log("sendBatch", handler.calls(PaymentsHandler.sendBatch.selector));
        console2.log("sendOddToken", handler.calls(PaymentsHandler.sendOddToken.selector));
        console2.log("sendReentrant", handler.calls(PaymentsHandler.sendReentrant.selector));
        console2.log("eve replay", attacker.calls(PaymentsAttackerHandler.replay.selector));
        console2.log("eve replayAsExecutor", attacker.calls(PaymentsAttackerHandler.replayAsExecutor.selector));
        console2.log("eve redirect", attacker.calls(PaymentsAttackerHandler.redirect.selector));
        console2.log("eve payPaymentsItself", attacker.calls(PaymentsAttackerHandler.payPaymentsItself.selector));
        console2.log("donations", donor.donations());
        console2.log("ids consumed", handler.consumedCount());
        console2.log("ids refused", handler.refusedCount());
    }
}
