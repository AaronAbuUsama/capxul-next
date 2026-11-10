// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IOptions } from "../../../../../src/interfaces/IOptions.sol";
import { Options_Shared_Test } from "../../../../utils/Options/Options_Shared_Test.sol";

/// @dev spec/options.md `endAllForExit` (only the Captable's Exits); invariants X2 (no options remain after an
/// exit) and O2.
contract EndAllForExit_Options_Unit_Concrete_Test is Options_Shared_Test {
    function test_WhenAGrantIsMadeAfterAnExitCall() external {
        // it should remain live until a later exit call
        uint256 first = _defaultGrant();
        vm.prank(exits);
        options.endAllForExit();
        uint256 later = _grant(users.bob, SHARES, gStart, gCliff, gEnd, gExpires);
        assertTrue(options.getGrant(first).cancelled, "first grant ended");
        assertFalse(options.getGrant(later).cancelled, "later grant remains live");
        vm.warp(block.timestamp + 1);
        vm.prank(exits);
        options.endAllForExit();
        assertTrue(options.getGrant(later).cancelled, "later exit ends later grant");
    }

    function test_WhenTheCallerIsNotExits() external {
        // it should revert with OnlyExits
        uint256 id = _acceptedGrant();
        vm.expectRevert(IOptions.OnlyExits.selector);
        vm.prank(users.eve);
        options.endAllForExit();
        vm.expectRevert(IOptions.OnlyExits.selector);
        vm.prank(address(safe));
        options.endAllForExit();
        assertEq(options.getGrant(id).endedAt, 0, "not ended");
    }

    function test_WhenExitsCallsItAtASettledSale() external {
        // it should end every grant
        // it should leave no option exercisable afterwards
        // it should emit AllEndedForExit
        uint256 alice = _acceptedGrant();
        uint256 bob = _grant(users.bob, SHARES, gStart, gCliff, gEnd, gExpires); // offered only
        vm.warp(_date(2029, 1, 1));
        _exercise(alice, 50_000);

        vm.expectEmit(address(options));
        emit IOptions.AllEndedForExit();
        vm.prank(exits);
        options.endAllForExit();

        assertEq(options.allocated(), 0, "nothing allocated");
        assertTrue(options.getGrant(alice).cancelled, "Alice's grant ended");
        assertTrue(options.getGrant(bob).cancelled, "Bob's offer ended");
        assertEq(options.getGrant(alice).endedAt, _now(), "ended now");

        vm.expectRevert(IOptions.ExerciseWindowClosed.selector);
        vm.prank(users.alice);
        options.exercise(alice, 1);
        vm.expectRevert(IOptions.NotLapsed.selector);
        options.lapse(alice);
        assertEq(common.balanceOf(users.alice), 50_000, "earlier exercise kept");
    }
}
