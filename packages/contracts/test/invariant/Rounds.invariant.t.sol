// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { console2 } from "forge-std/console2.sol";

import { IRounds } from "../../src/interfaces/IRounds.sol";
import { Rounds_Shared_Test } from "../utils/Rounds/Rounds_Shared_Test.sol";
import { RoundsAttackerHandler } from "./handlers/RoundsAttackerHandler.sol";
import { RoundsHandler } from "./handlers/RoundsHandler.sol";

/// @notice Rounds invariants over the Board, three investors, Series Seed's class Governor and eve: R4 and I3 (the
/// Fuzz-inv rows of invariants.md), and alongside them R1, R2 and R3 (whose proofs are Halmos and Certora) as
/// cross-checks against the handler's own figures, E4 for the classes a down round adjusts, and Rounds holding
/// nothing.
contract Rounds_Invariant_Test is Rounds_Shared_Test {
    uint256 internal constant SAFE_START = 1_000_000 * 1e6; // Base_Test mints the Safe $1M

    RoundsHandler internal handler;
    RoundsAttackerHandler internal attacker;

    function setUp() public override {
        super.setUp();
        address[] memory investors = new address[](3);
        investors[0] = users.investor;
        investors[1] = angel;
        investors[2] = fund;
        // The Board's standing issuer allowance for the round class (each allocation batch would raise it).
        vm.prank(address(safe));
        captable.setIssuerAllowance(address(rounds), SERIES_C, type(uint128).max);
        handler = new RoundsHandler(rounds, captable, usdc, address(safe), seedGovernor, investors);
        attacker = new RoundsAttackerHandler(rounds, implementation, handler, users.eve, address(usdc), investors);
        targetContract(address(handler));
        targetContract(address(attacker));
        excludeSender(address(safe));
    }

    /// @dev R1 and R2: every round's issued shares are exactly what its investors paid for, the class supply is the
    /// paid shares plus the conversions, the Safe received exactly the money, and each pay moved exactly
    /// `shares * price`.
    function invariant_R1_R2_paidExactlyAndIssued() external view {
        uint256 n = handler.pricedIdsLength();
        for (uint256 i; i < n; ++i) {
            uint256 id = handler.pricedIds(i);
            assertEq(rounds.pricedRound(id).issuedShares, handler.ghostPaidShares(id), "R2 issued == paid for");
        }
        assertEq(
            _token(SERIES_C).totalSupply(),
            handler.ghostPaidSharesTotal() + handler.ghostConvertedShares(),
            "R2 supply == paid + converted"
        );
        assertEq(usdc.balanceOf(address(safe)), SAFE_START + handler.ghostMoneyToSafe(), "the Safe got the money");
        assertFalse(handler.ghostR1Broken(), "R1 a pay moved other than shares x price");
    }

    /// @dev R3: once a round is closed or cancelled its issued count never moves, and no late pay succeeds.
    function invariant_R3_nothingAfterEnd() external view {
        uint256 n = handler.pricedIdsLength();
        for (uint256 i; i < n; ++i) {
            uint256 id = handler.pricedIds(i);
            if (!handler.ghostEnded(id)) continue;
            assertEq(rounds.pricedRound(id).issuedShares, handler.ghostIssuedAtEnd(id), "R3 issued after the end");
        }
        assertFalse(attacker.ghostR3Broken(), "R3 a late pay succeeded");
    }

    /// @dev R4: every conversion issued `floor(amount / conversionPrice)` to each note's investor, moved no money,
    /// and marked the note converted.
    function invariant_R4_safeConversionFloor() external view {
        assertFalse(handler.ghostR4Broken(), "R4 conversion");
        uint256 converted;
        uint256 n = handler.noteIdsLength();
        for (uint256 i; i < n; ++i) {
            if (rounds.safeNote(handler.noteIds(i)).converted) ++converted;
        }
        assertEq(converted, handler.ghostConvertedNotes(), "R4 converted notes");
    }

    /// @dev Allocation never passes the round's maximum, and issue never passes allocation.
    function invariant_allocationBounded() external view {
        uint256 n = handler.pricedIdsLength();
        for (uint256 i; i < n; ++i) {
            IRounds.PricedRound memory r = rounds.pricedRound(handler.pricedIds(i));
            assertLe(r.issuedShares, r.allocatedShares, "issued <= allocated");
            assertLe(r.allocatedShares, r.maxShares, "allocated <= maximum");
        }
    }

    /// @dev E4 (Rounds' side): a down round only lowers an earlier class's conversion price, never below its floor.
    function invariant_E4_conversionPricesOnlyFall() external view {
        assertFalse(handler.ghostE4Broken(), "E4 a close raised a price or broke a floor");
        assertLe(captable.conversionPrice(SEED), SEED_PRICE, "Seed never above its issue price");
        assertGe(captable.conversionPrice(SEED), SEED_FLOOR, "Seed floor");
        assertLe(captable.conversionPrice(SERIES_A), A_PRICE, "A never above its issue price");
        assertGe(captable.conversionPrice(SERIES_A), A_FLOOR, "A floor");
    }

    function invariant_holdsNothing() external view {
        _assertHoldsNothing();
    }

    /// @dev I3: the implementation was never initialised and cannot be.
    function invariant_I3_implementationSealed() external {
        try implementation.initialize(address(safe), address(captable), address(payments)) {
            fail();
        } catch (bytes memory reason) {
            assertEq(bytes4(reason), IRounds.AlreadyInitialized.selector, "I3 sealed");
        }
    }

    /// @dev H4: eve never ran a Board function, paid without an allocation or consented without a class.
    function invariant_eveNeverWins() external view {
        assertFalse(attacker.ghostEveWon(), "eve won");
        assertEq(_token(SERIES_C).balanceOf(users.eve), 0, "eve holds no shares");
    }

    function afterInvariant() external view {
        console2.log("createSafeRound", handler.calls("createSafeRound"));
        console2.log("inviteSafe", handler.calls("inviteSafe"));
        console2.log("signSafe", handler.calls("signSafe"));
        console2.log("closeSafeRound", handler.calls("closeSafeRound"));
        console2.log("convertSafes", handler.calls("convertSafes"));
        console2.log("createPricedRound", handler.calls("createPricedRound"));
        console2.log("invite", handler.calls("invite"));
        console2.log("commit", handler.calls("commit"));
        console2.log("allocate", handler.calls("allocate"));
        console2.log("pay", handler.calls("pay"));
        console2.log("consent", handler.calls("consent"));
        console2.log("close", handler.calls("close"));
        console2.log("cancel", handler.calls("cancel"));
        console2.log("warp", handler.calls("warp"));
        console2.log("attacker attempts", attacker.attempts());
    }
}
