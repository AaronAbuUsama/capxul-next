// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ShareClass_Shared_Test } from "../../../../utils/ShareClass/ShareClass_Shared_Test.sol";

/// @dev D5: the Safe's balance history, which the Captable leaves out of supply.
contract SafeBalanceAt_ShareClass_Unit_Concrete_Test is ShareClass_Shared_Test {
    function test_WhenTheTimepointIsInTheFuture() external {
        // it should reject the future lookup
        uint48 now_ = token.clock();
        vm.expectRevert(abi.encodeWithSignature("ERC5805FutureLookup(uint256,uint48)", uint256(now_) + 1, now_));
        token.safeBalanceAt(uint256(now_) + 1);
    }

    function test_ShouldReturnTheSafesBalanceAtThatTime() external {
        uint256 t0 = vm.getBlockTimestamp();
        _mint(address(safe), 100);
        vm.warp(t0 + 10);
        _mint(address(safe), 50);
        vm.warp(t0 + 20);
        // it should return the Safe's balance at that time
        assertEq(token.safeBalanceAt(t0), 100, "at t0");
        assertEq(token.safeBalanceAt(t0 + 9), 100, "between");
        assertEq(token.safeBalanceAt(t0 + 10), 150, "at t0 + 10");
    }

    function test_GivenTheSafeNeverHeldShares() external {
        uint256 t0 = vm.getBlockTimestamp();
        _mint(users.alice, 100);
        vm.warp(t0 + 1);
        // it should return 0
        assertEq(token.safeBalanceAt(t0), 0, "at t0");
        assertEq(token.safeBalanceAt(vm.getBlockTimestamp()), 0, "now");
    }

    function test_GivenTheSafesBalanceChangedAfterTheTimepoint() external {
        uint256 t0 = vm.getBlockTimestamp();
        _mint(address(safe), 100);
        vm.warp(t0 + 1 days);
        _forcedMove(address(safe), users.alice, 40);
        // it should return the balance at the timepoint
        assertEq(token.safeBalanceAt(t0), 100, "at t0");
        assertEq(token.safeBalanceAt(t0 + 1 days - 1), 100, "just before the move");
        assertEq(token.safeBalanceAt(t0 + 1 days), 60, "at the move");
    }

    function test_ShouldEqualBalanceOfTheSafeWhenReadAtTheCurrentTime() external {
        _mint(address(safe), 100);
        _mint(users.alice, 70);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        vm.prank(users.alice);
        token.transfer(address(safe), 20);
        _burn(address(safe), 5);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        _forcedMove(address(safe), users.bob, 15);
        // it should equal balanceOf the Safe when read at the current time
        assertEq(token.safeBalanceAt(vm.getBlockTimestamp()), token.balanceOf(address(safe)), "now equals balanceOf");
        assertEq(token.balanceOf(address(safe)), 100, "balance");
    }
}
