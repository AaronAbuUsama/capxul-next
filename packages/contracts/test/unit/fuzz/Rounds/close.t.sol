// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Rounds_Shared_Test } from "../../../utils/Rounds/Rounds_Shared_Test.sol";

/// @dev `close` over A, the shares sold and the round price against Series A's conversion price (E4 and the
/// broad-based weighted average): the new price is the model's (rounded down, clamped at the floor), never above
/// the old one, unchanged when the round price is not below it.
contract Close_Rounds_Unit_Fuzz_Test is Rounds_Shared_Test {
    function testFuzz_Close_AntiDilution(uint256 a, uint128 shares, uint128 price) external {
        a = bound(a, 0, 1e12);
        shares = uint128(bound(shares, 1, 10_000_000));
        price = uint128(bound(price, 1, 2 * uint256(A_PRICE)));
        vm.assume(price >= SEED_PRICE); // Seed's class Governor is not asked here
        uint256 id = _createPricedRound(SERIES_C, price, shares);
        _allocated(id, users.investor, shares);
        _pay(id, users.investor);
        _close(id, a);
        uint128 expected = _modelAntiDilution(A_PRICE, price, a, shares, A_FLOOR);
        uint128 got = captable.conversionPrice(SERIES_A);
        assertEq(got, expected, "the model");
        assertLe(got, A_PRICE, "E4 never increases");
        assertGe(got, A_FLOOR, "E4 never below the floor");
        if (price >= A_PRICE) assertEq(got, A_PRICE, "not a down round for Series A");
        assertEq(captable.conversionPrice(SEED), SEED_PRICE, "Seed untouched");
    }
}
