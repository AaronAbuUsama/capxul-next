// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IRounds } from "../../../../src/interfaces/IRounds.sol";
import { Rounds_Shared_Test } from "../../../utils/Rounds/Rounds_Shared_Test.sol";

/// @dev `commit` over the amount against the invitation: within it the commitment is recorded and no money moves;
/// above it `OverInvited(max, amount)`.
contract Commit_Rounds_Unit_Fuzz_Test is Rounds_Shared_Test {
    function testFuzz_Commit(uint128 maxAmount, uint128 amount) external {
        maxAmount = uint128(bound(maxAmount, 1, type(uint128).max));
        uint256 id = _createPricedRound(SERIES_C, PRICE, MAX_SHARES);
        _invite(id, users.investor, maxAmount);
        uint256 before = usdc.balanceOf(users.investor);
        if (amount > maxAmount) {
            vm.expectRevert(abi.encodeWithSelector(IRounds.OverInvited.selector, maxAmount, amount));
        }
        vm.prank(users.investor);
        rounds.commit(id, amount, SUBSCRIPTION);
        assertEq(rounds.position(id, users.investor).committed, amount <= maxAmount ? amount : 0, "committed");
        assertEq(usdc.balanceOf(users.investor), before, "no money moved");
    }
}
