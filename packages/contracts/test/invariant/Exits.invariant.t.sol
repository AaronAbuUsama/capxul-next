// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IExits } from "../../src/interfaces/IExits.sol";

import { Exits_Test } from "../utils/Exits/Exits_Test.sol";
import { ExitsHandler } from "./handlers/ExitsHandler.sol";

/// @notice Invariants X1 to X4 and I3 (invariants.md, "Equity: Exits") over one company's exit in a token that
/// can blacklist a payee: settle with random claim indexes, claim, redirectClaim, collect, and Eve's attacks.
contract Exits_Invariant_Test is Exits_Test {
    ExitsHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new ExitsHandler(
            exits, payments, factory, blacklistToken, address(safe), governor, users.eve, users.bob, _holdings()
        );
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = ExitsHandler.settle.selector;
        selectors[1] = ExitsHandler.claim.selector;
        selectors[2] = ExitsHandler.redirect.selector;
        selectors[3] = ExitsHandler.collect.selector;
        selectors[4] = ExitsHandler.attack.selector;
        selectors[5] = ExitsHandler.donate.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
    }

    /// @dev X1: the payouts of the settled sale add up to its proceeds exactly, and the Board paid all of it.
    function invariant_X1_payoutsSumToProceeds() public view {
        if (!handler.settled()) return;
        assertEq(handler.previewSum(), handler.proceeds(), "payouts sum to the proceeds");
        // setUp funds the Safe with $1m of this token; the handler adds exactly the proceeds, so the batch
        // paid out every unit of them and left that $1m.
        assertEq(blacklistToken.balanceOf(address(safe)), 1_000_000e6, "the batch paid out every unit");
    }

    /// @dev X2: after the exit settles, no shares of any class and no options remain, and nothing can be issued.
    function invariant_X2_nothingRemainsAfterSettle() public view {
        if (!handler.settled()) return;
        assertEq(captable.tokenOf(COMMON).totalSupply(), 0, "no Common");
        assertEq(captable.tokenOf(SERIES_A).totalSupply(), 0, "no Series A");
        assertEq(options.allocated(), 0, "no options");
        assertTrue(captable.closedForExit(), "closed");
    }

    /// @dev X3: Exits changes no donated balance, and each open claim's escrow holds at least its amount.
    function invariant_X3_exitsHoldsNothingAndEscrowsHoldTheirClaims() public view {
        assertEq(blacklistToken.balanceOf(address(exits)), handler.donatedToExits(), "only donations remain in Exits");
        if (!handler.settled()) return;
        for (uint256 i; i < handler.payoutCount(); ++i) {
            if (!handler.open(i)) continue;
            IExits.Claim memory c = exits.claimOf(SALE, i);
            assertEq(c.amount, handler.amountOf(i), "claim amount unchanged");
            assertGe(blacklistToken.balanceOf(c.escrow), handler.amountOf(i), "escrow holds the full claim");
        }
    }

    /// @dev X4: a refused payee never blocks a settle; each claim is paid at most once; Eve never succeeds.
    function invariant_X4_claimsPaidOnceAndNeverBlockSettle() public view {
        if (handler.settleCalls() > 0) assertTrue(handler.settled(), "settle went through");
        for (uint256 i; i < handler.payoutCount(); ++i) {
            assertLe(handler.paidOut(i), 1, "a claim is paid at most once");
        }
        assertEq(handler.eveWins(), 0, "Eve never succeeds");
    }

    /// @dev I3: the implementation behind the clone can never be initialised.
    function invariant_I3_implementationCannotBeInitialised() public {
        (bool ok, bytes memory err) = address(implementation)
            .call(
                abi.encodeCall(
                    IExits.initialize, (users.eve, users.eve, users.eve, users.eve, users.eve, users.eve, users.eve)
                )
            );
        assertFalse(ok, "the implementation was initialised");
        assertEq(bytes4(err), IExits.AlreadyInitialized.selector, "AlreadyInitialized");
    }
}
