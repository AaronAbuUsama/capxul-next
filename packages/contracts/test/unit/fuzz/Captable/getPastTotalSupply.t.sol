// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Captable_Test } from "../../../utils/Captable/Captable_Test.sol";

/// @dev D5 (E8) over a range of holdings: the Safe's shares never vote and never count in the supply, including
/// after they leave the Safe by forced transfer.
contract GetPastTotalSupply_Captable_Unit_Fuzz_Test is Captable_Test {
    function testFuzz_GetPastTotalSupply_SafeLeftOut(uint128 toSafe, uint128 toAmira, uint128 resold) external {
        toSafe = uint128(bound(toSafe, 1, 4_000_000));
        toAmira = uint128(bound(toAmira, 1, 4_000_000));
        resold = uint128(bound(resold, 0, toSafe));
        _issue(COMMON, address(safe), toSafe);
        _issue(COMMON, users.amira, toAmira);
        _warp(1);
        assertEq(captable.getPastTotalSupply(vm.getBlockTimestamp() - 1), toAmira, "Safe left out");
        assertEq(captable.getPastVotes(address(safe), vm.getBlockTimestamp() - 1), 0, "Safe has no votes");

        if (resold > 0) {
            vm.prank(address(governor));
            captable.forcedTransfer(COMMON, address(safe), users.investor, resold, REASON);
        }
        _warp(1);
        assertEq(
            captable.getPastTotalSupply(vm.getBlockTimestamp() - 1), uint256(toAmira) + resold, "resold shares count"
        );
        assertEq(captable.getPastVotes(users.investor, vm.getBlockTimestamp() - 1), resold, "and vote for the buyer");
    }
}
