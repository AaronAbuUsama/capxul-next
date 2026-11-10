// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IRounds } from "../../../../src/interfaces/IRounds.sol";
import { Rounds_Shared_Test } from "../../../utils/Rounds/Rounds_Shared_Test.sol";

/// @dev `createSafeRound` over the cap, the discount and the close date: valid terms are stored exactly, anything
/// else is `InvalidRound` and creates nothing.
contract CreateSafeRound_Rounds_Unit_Fuzz_Test is Rounds_Shared_Test {
    function testFuzz_CreateSafeRound(uint128 cap, uint16 discountBps, uint64 closesAt) external {
        bool valid = cap != 0 && discountBps < 10_000 && closesAt >= _now();
        vm.prank(address(safe));
        if (!valid) {
            _expectInvalidRound(
                abi.encodeCall(IRounds.createSafeRound, (address(usdc), cap, discountBps, closesAt, SAFE_FORM))
            );
            assertEq(_createSafeRound(DISCOUNT), 1, "nothing was created");
            return;
        }
        uint256 id = rounds.createSafeRound(address(usdc), cap, discountBps, closesAt, SAFE_FORM);
        IRounds.SafeRound memory r = rounds.safeRound(id);
        assertEq(id, 1, "id");
        assertEq(r.valuationCap, cap, "cap");
        assertEq(r.discountBps, discountBps, "discount");
        assertEq(r.closesAt, closesAt, "closes at");
        assertFalse(r.closed, "open");
    }
}
