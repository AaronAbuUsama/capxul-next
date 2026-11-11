// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IOptions } from "../../../../../src/interfaces/IOptions.sol";
import { Options_Shared_Test } from "../../../../utils/Options/Options_Shared_Test.sol";

/// @dev spec/options.md `end`; invariants H4 and O2 (after `end`, only the vested part stays allocated). The
/// leaver numbers are slices/W4.md's: leaving after 36 of 48 months keeps 112,500 and returns 37,500.
contract End_Options_Unit_Concrete_Test is Options_Shared_Test {
    function test_WhenTheCallerIsNotTheSafe() external {
        // it should revert with OnlyBoard
        uint256 id = _acceptedGrant();
        vm.expectRevert(IOptions.OnlyBoard.selector);
        vm.prank(users.eve);
        options.end(id, _now());
        vm.expectRevert(IOptions.OnlyBoard.selector);
        vm.prank(users.alice);
        options.end(id, _now());
        assertEq(options.getGrant(id).endedAt, 0, "not ended");
    }

    function test_WhenTheGrantAlreadyEnded() external {
        // it should revert with AlreadyEnded
        uint256 id = _acceptedGrant();
        _end(id, _now());
        vm.expectRevert(IOptions.AlreadyEnded.selector);
        vm.prank(address(safe));
        options.end(id, _now() + 1 days);
    }

    function test_WhenTheEndDateIsInThePast() external {
        // it should revert with InvalidSchedule
        uint256 id = _acceptedGrant();
        vm.warp(_date(2029, 1, 1));
        vm.expectRevert(IOptions.InvalidSchedule.selector);
        vm.prank(address(safe));
        options.end(id, _now() - 1);
        assertEq(options.getGrant(id).endedAt, 0, "not ended");
    }

    function test_WhenTheEndDateIsNowOrLater() external {
        // it should stop vesting at the end date
        // it should return the unvested shares to the pool
        // it should keep vested options exercisable for the window
        // it should emit OptionsEnded
        uint256 id = _acceptedGrant();
        uint64 leaves = _date(2029, 1, 1);
        vm.warp(leaves);
        vm.expectEmit(address(options));
        emit IOptions.OptionsEnded(id, leaves, 37_500);
        _end(id, leaves);
        assertEq(options.getGrant(id).endedAt, leaves, "endedAt");
        assertEq(options.vestedOf(id, gEnd), 112_500, "vesting stopped");
        assertEq(options.allocated(), 112_500, "unvested returned");
        assertEq(options.pool(), POOL, "pool unchanged: free room grew");

        vm.warp(leaves + uint64(WINDOW_DAYS) * 1 days);
        _exercise(id, 112_500);
        assertEq(common.balanceOf(users.alice), 112_500, "exercised in the window");
        assertEq(options.allocated(), 0, "nothing left allocated");

        // An end date in the future: vesting runs on until then (42 of 48 months vest 131,250).
        uint256 second = _grant(users.bob, SHARES, gStart, gCliff, gEnd, gExpires);
        _accept(second);
        uint64 later = _date(2029, 7, 1);
        uint128 before = options.allocated();
        vm.expectEmit(address(options));
        emit IOptions.OptionsEnded(second, later, 18_750);
        _end(second, later);
        assertEq(options.vestedOf(second, gEnd), 131_250, "vests until the future end date");
        assertEq(options.allocated(), before - 18_750, "only the unvested part returned");
    }
}
