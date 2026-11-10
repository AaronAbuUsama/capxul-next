// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Rounds_Shared_Test } from "../../../utils/Rounds/Rounds_Shared_Test.sol";

/// @dev `convertSafes` over the note amount, the cap, the discount, the company capitalization and the round price
/// (R4): the investor receives `floor(amount / conversionPrice)` with the conversion price the lower of the cap
/// price and the discounted round price, both rounded down; the dust is less than one conversion price and stays
/// with the company (the Safe's money is unchanged). A note whose shares round to 0 is marked converted and issues
/// nothing.
contract ConvertSafes_Rounds_Unit_Fuzz_Test is Rounds_Shared_Test {
    function testFuzz_ConvertSafes(
        uint128 amount,
        uint128 cap,
        uint16 discountBps,
        uint256 capitalization,
        uint128 price
    )
        external
    {
        amount = uint128(bound(amount, 1, 10_000_000 * USDC_UNIT));
        cap = uint128(bound(cap, 1, 1e18)); // up to $1 trillion
        discountBps = uint16(bound(discountBps, 0, 9999));
        capitalization = bound(capitalization, 1, 1e12);
        price = uint128(bound(price, 1, 1e12)); // up to $1,000,000 a share
        uint256 conversionPrice = _modelConversionPrice(cap, capitalization, price, discountBps);
        vm.assume(conversionPrice > 0); // a zero conversion price is refused (unit test of the leaf's guard)

        vm.prank(address(safe));
        uint256 safeId = rounds.createSafeRound(address(usdc), cap, discountBps, _now() + SAFE_WINDOW, SAFE_FORM);
        _inviteSafe(safeId, angel, amount);
        uint256[] memory notes = new uint256[](1);
        notes[0] = _signSafe(safeId, angel, amount, ANGEL_SAFE);
        uint256 pricedId = _createPricedRound(SERIES_C, price, MAX_SHARES);
        uint256 expected = amount / conversionPrice;
        vm.assume(expected <= AUTHORISED);
        vm.prank(address(safe));
        captable.setIssuerAllowance(address(rounds), SERIES_C, uint128(expected));
        uint256 safeBefore = usdc.balanceOf(address(safe));

        _convert(notes, pricedId, capitalization);
        uint256 got = _token(SERIES_C).balanceOf(angel);
        assertEq(got, expected, "R4 floor(amount / conversionPrice)");
        assertLe(got * conversionPrice, amount, "never more than paid for");
        assertLt(amount - got * conversionPrice, conversionPrice, "the dust is under one share");
        assertEq(usdc.balanceOf(address(safe)), safeBefore, "the dust stays with the company");
        assertTrue(rounds.safeNote(notes[0]).converted, "converted");
        _assertHoldsNothing();
    }
}
