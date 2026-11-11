// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IOptions } from "../../../../src/interfaces/IOptions.sol";
import { Options_Shared_Test } from "../../../utils/Options/Options_Shared_Test.sol";

/// @dev `end` over the call time and the end date: refused in the past; otherwise exactly the unvested part at
/// the end date returns (O2).
contract End_Options_Unit_Fuzz_Test is Options_Shared_Test {
    function testFuzz_End(uint64 t, uint64 endedAt) external {
        uint256 id = _acceptedGrant();
        t = uint64(bound(t, gStart, gExpires));
        vm.warp(t);
        endedAt = uint64(bound(endedAt, gStart, gExpires));
        vm.prank(address(safe));
        if (endedAt < t) {
            vm.expectRevert(IOptions.InvalidSchedule.selector);
            options.end(id, endedAt);
            assertEq(options.allocated(), SHARES, "allocated kept");
        } else {
            uint128 vested = _model(SHARES, gStart, gCliff, gEnd, 0, endedAt);
            vm.expectEmit(address(options));
            emit IOptions.OptionsEnded(id, endedAt, SHARES - vested);
            options.end(id, endedAt);
            assertEq(options.allocated(), vested, "only the vested part stays allocated");
            assertEq(options.vestedOf(id, type(uint64).max), vested, "frozen");
        }
    }
}
