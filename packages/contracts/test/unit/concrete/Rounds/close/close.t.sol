// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICaptable } from "../../../../../src/interfaces/ICaptable.sol";
import { IRounds } from "../../../../../src/interfaces/IRounds.sol";
import { Vm } from "forge-std/Vm.sol";
import { Rounds_Shared_Test } from "../../../../utils/Rounds/Rounds_Shared_Test.sol";
import { RoundsMathHarness } from "../../../../utils/Rounds/RoundsMathHarness.sol";

/// @dev spec/rounds.md `close`; invariants E4 (a conversion price only falls, never below its floor) and R3
/// (after close nothing more is issued). The down round: Series C sells 4,000,000 at $2.3724 against Series A's
/// $2.5103 with A = 24,000,000 deemed outstanding, so B = floor(4,000,000 x 2.3724 / 2.5103) = 3,780,265 and
/// CP2 = floor(2,510,300 x 27,780,265 / 28,000,000) = 2,490,599 ($2.490599). Series Seed ($1.1413) is not above
/// the round price and is left alone. An earlier class is one with a lower class id that has an issue price.
contract Close_Rounds_Unit_Concrete_Test is Rounds_Shared_Test {
    uint256 internal constant A = 24_000_000;
    uint128 internal constant A_AFTER = 2_490_599;

    function test_WhenTheCallerIsNotTheSafe() external {
        // it should revert with OnlyBoard
        uint256 id = _defaultAllocated();
        _pay(id, users.investor);
        vm.expectRevert(IRounds.OnlyBoard.selector);
        vm.prank(users.eve);
        rounds.close(id, A);
        vm.expectRevert(IRounds.OnlyBoard.selector);
        vm.prank(seedGovernor);
        rounds.close(id, A);
        assertFalse(rounds.pricedRound(id).closed, "open");
    }

    function test_WhenThePayByDateHasNotPassedAndAllocationsAreUnpaid() external {
        // it should revert with InvalidRound
        uint256 id = _defaultAllocated();
        _allocated(id, angel, 1000);
        _pay(id, angel);
        vm.warp(rounds.pricedRound(id).payBy); // the last second to pay is not past it
        vm.prank(address(safe));
        _expectInvalidRound(abi.encodeCall(IRounds.close, (id, A)));
        assertFalse(rounds.pricedRound(id).closed, "open");
        _pay(id, users.investor); // the investor can still pay
    }

    function test_WhenAnAffectedClassWithAClassGovernorHasNotConsented() external {
        // it should revert with ConsentMissing
        uint256 id = _createPricedRound(SERIES_C, 1_000_000, MAX_SHARES); // below Seed's $1.1413
        _allocated(id, users.investor, SHARES);
        _pay(id, users.investor);
        vm.expectRevert(abi.encodeWithSelector(IRounds.ConsentMissing.selector, SEED));
        vm.prank(address(safe));
        rounds.close(id, A);
        assertEq(captable.conversionPrice(SEED), SEED_PRICE, "Seed unchanged");
        assertEq(captable.conversionPrice(SERIES_A), A_PRICE, "nothing applied");

        // With the consent the round closes and both affected classes adjust.
        vm.prank(seedGovernor);
        rounds.consent(id);
        _close(id, A);
        assertLt(captable.conversionPrice(SEED), SEED_PRICE, "Seed adjusted");
        assertLt(captable.conversionPrice(SERIES_A), A_PRICE, "Series A adjusted (no class Governor)");
    }

    modifier whenTheRoundCanClose() {
        _;
    }

    function test_WhenTheRoundCanClose() external whenTheRoundCanClose {
        // it should mark the round closed and lapse unpaid allocations
        // it should emit RoundClosed with every adjustment
        uint256 id = _defaultAllocated();
        _allocated(id, angel, 1000); // never pays
        _pay(id, users.investor);
        vm.warp(rounds.pricedRound(id).payBy + 1);

        IRounds.Adjustment[] memory adjustments = new IRounds.Adjustment[](1);
        adjustments[0] = IRounds.Adjustment({ classId: SERIES_A, oldPrice: A_PRICE, newPrice: A_AFTER });
        vm.expectEmit(true, true, true, true, address(rounds));
        emit IRounds.RoundClosed(id, adjustments);
        _close(id, A);

        IRounds.PricedRound memory r = rounds.pricedRound(id);
        assertTrue(r.closed, "closed");
        assertEq(r.issuedShares, SHARES, "only the paid shares");
        vm.expectRevert(IRounds.RoundIsClosed.selector);
        vm.prank(angel);
        rounds.pay(id);
        assertEq(_token(SERIES_C).balanceOf(angel), 0, "the unpaid allocation lapsed (R3)");
        vm.expectRevert(IRounds.RoundIsClosed.selector);
        vm.prank(address(safe));
        rounds.close(id, A);
        _assertHoldsNothing();
    }

    function test_GivenExtremeArithmeticInputs() external whenTheRoundCanClose {
        // it should preserve the price bound and checked arithmetic without a redundant clamp
        RoundsMathHarness math = new RoundsMathHarness();
        uint128 max = type(uint128).max;
        assertEq(math.exposed_antiDilutedPrice(max, max, type(uint256).max, 1), max, "unchanged at equal price");
        assertEq(math.exposed_antiDilutedPrice(max, 0, type(uint256).max, 0), max, "unchanged without issuance");
        assertEq(math.exposed_antiDilutedPrice(max, max - 1, max, 1), max - 1, "uint128 boundary rounds down");
        assertEq(math.exposed_antiDilutedPrice(max, max - 1, 1, 1), max / 2, "small denominator");
        vm.expectRevert(abi.encodeWithSignature("Panic(uint256)", 0x11));
        math.exposed_antiDilutedPrice(3, 2, 0, type(uint256).max);
        vm.expectRevert(abi.encodeWithSignature("Panic(uint256)", 0x11));
        math.exposed_antiDilutedPrice(1, 0, type(uint256).max, 1);
    }

    function test_GivenNoEarlierClasssConversionPriceIsAboveTheRoundPrice() external whenTheRoundCanClose {
        // it should change no conversion price
        uint256 id = _createPricedRound(SERIES_C, 3_000_000, MAX_SHARES);
        _allocated(id, users.investor, SHARES);
        _pay(id, users.investor); // everything allocated is paid: the round closes before its pay-by date
        vm.expectCall(address(captable), abi.encodeWithSelector(captable.setConversionPrice.selector), 0);
        vm.recordLogs();
        _close(id, A);
        assertEq(captable.conversionPrice(SEED), SEED_PRICE, "Seed unchanged");
        assertEq(captable.conversionPrice(SERIES_A), A_PRICE, "Series A unchanged");
        Vm.Log memory log = _oneLog(IRounds.RoundClosed.selector);
        IRounds.Adjustment[] memory logged = abi.decode(log.data, (IRounds.Adjustment[]));
        assertEq(logged.length, 0, "no adjustment");
        assertTrue(rounds.pricedRound(id).closed, "closed");
    }

    function test_GivenAnEarlierClasssConversionPriceIsAboveTheRoundPrice() external whenTheRoundCanClose {
        // it should compute the broad based weighted average price from A and the money raised and the shares issued
        // it should round it down to the price unit
        // it should set it on the Captable
        uint256 id = _defaultAllocated();
        _pay(id, users.investor);
        assertEq(_modelAntiDilution(A_PRICE, PRICE, A, SHARES, A_FLOOR), A_AFTER, "the model agrees");
        vm.expectEmit(true, true, true, true, address(captable));
        emit ICaptable.ConversionPriceSet(SERIES_A, A_AFTER);
        _close(id, A);
        assertEq(captable.conversionPrice(SERIES_A), A_AFTER, "Series A to $2.490599, rounded down");
        assertEq(captable.conversionPrice(SEED), SEED_PRICE, "Seed is below the round price");
        assertEq(captable.conversionPrice(SERIES_C), PRICE, "the round's own class is not earlier");

        // Never below the floor: a tiny A and a huge round push the formula under Series A's $0.25 floor.
        uint256 deep = _createPricedRound(SERIES_C, 10_000, MAX_SHARES); // $0.01
        _allocated(deep, users.investor, MAX_SHARES);
        _pay(deep, users.investor);
        vm.prank(seedGovernor);
        rounds.consent(deep);
        assertEq(_modelAntiDilution(A_AFTER, 10_000, 1, MAX_SHARES, A_FLOOR), A_FLOOR, "the formula is clamped");
        _close(deep, 1);
        assertEq(captable.conversionPrice(SERIES_A), A_FLOOR, "Series A at its floor (E4)");
        assertEq(captable.conversionPrice(SEED), SEED_FLOOR, "Seed at its floor (E4)");

        // "Above" is strict: a round at exactly Seed's price does not affect Seed, so it closes without Seed's
        // consent and Seed's price stays.
        uint256 equal = _createPricedRound(SERIES_C, SEED_FLOOR, MAX_SHARES);
        _allocated(equal, users.investor, SHARES);
        _pay(equal, users.investor);
        _close(equal, A);
        assertTrue(rounds.pricedRound(equal).closed, "closed without Seed's consent");
        assertEq(captable.conversionPrice(SEED), SEED_FLOOR, "Seed unchanged at the equal price");
    }
}
