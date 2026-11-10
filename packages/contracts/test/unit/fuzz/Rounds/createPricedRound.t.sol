// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IRounds } from "../../../../src/interfaces/IRounds.sol";
import { Rounds_Shared_Test } from "../../../utils/Rounds/Rounds_Shared_Test.sol";

/// @dev `createPricedRound` over the price, the maximum and the pay-by date (any `uint128`, any `uint64`).
contract CreatePricedRound_Rounds_Unit_Fuzz_Test is Rounds_Shared_Test {
    function testFuzz_CreatePricedRound(uint128 price, uint128 maxShares, uint64 payBy) external {
        bool valid = price != 0 && maxShares != 0 && payBy >= _now();
        vm.prank(address(safe));
        if (!valid) {
            _expectInvalidRound(
                abi.encodeCall(IRounds.createPricedRound, (SERIES_C, address(usdc), price, maxShares, payBy, ROUND_DOC))
            );
            assertEq(_createPricedRound(SERIES_C, PRICE, MAX_SHARES), 1, "nothing was created");
            return;
        }
        uint256 id = rounds.createPricedRound(SERIES_C, address(usdc), price, maxShares, payBy, ROUND_DOC);
        IRounds.PricedRound memory r = rounds.pricedRound(id);
        assertEq(r.price, price, "price");
        assertEq(r.maxShares, maxShares, "maximum");
        assertEq(r.payBy, payBy, "pay by");
        assertEq(r.allocatedShares + r.issuedShares, 0, "empty");
    }
}
