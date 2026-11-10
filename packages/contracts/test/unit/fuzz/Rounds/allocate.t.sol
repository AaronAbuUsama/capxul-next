// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IRounds } from "../../../../src/interfaces/IRounds.sol";
import { Rounds_Shared_Test } from "../../../utils/Rounds/Rounds_Shared_Test.sol";

/// @dev `allocate` over the round's maximum and two allocations: `allocatedShares` never exceeds `maxShares`, an
/// allocation over what is left is `OverAllocated(left, requested)`.
contract Allocate_Rounds_Unit_Fuzz_Test is Rounds_Shared_Test {
    function testFuzz_Allocate(uint128 maxShares, uint128 a, uint128 b) external {
        maxShares = uint128(bound(maxShares, 1, type(uint128).max));
        a = uint128(bound(a, 1, type(uint128).max));
        b = uint128(bound(b, 1, type(uint128).max));
        uint256 id = _createPricedRound(SERIES_C, PRICE, maxShares);
        _invite(id, users.investor, INVITED);
        _commit(id, users.investor, INVITED);
        _invite(id, angel, INVITED);
        _commit(id, angel, INVITED);

        uint128 allocated = _try(id, users.investor, maxShares, 0, a);
        allocated = _try(id, angel, maxShares, allocated, b);
        assertEq(rounds.pricedRound(id).allocatedShares, allocated, "allocated");
        assertLe(allocated, maxShares, "never past the maximum");
        assertEq(
            uint256(rounds.position(id, users.investor).shares) + rounds.position(id, angel).shares,
            allocated,
            "the positions sum to the round"
        );
    }

    function _try(
        uint256 id,
        address investor,
        uint128 maxShares,
        uint128 allocated,
        uint128 n
    )
        private
        returns (uint128)
    {
        uint128 left = maxShares - allocated;
        if (n > left) vm.expectRevert(abi.encodeWithSelector(IRounds.OverAllocated.selector, left, n));
        vm.prank(address(safe));
        rounds.allocate(id, investor, n);
        return n > left ? allocated : allocated + n;
    }
}
