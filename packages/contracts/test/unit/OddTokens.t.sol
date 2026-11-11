// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { Base_Test } from "../Base.t.sol";

/// @notice Proves each odd token in Base_Test misbehaves the way a contract's tests rely on.
contract OddTokens_Unit_Test is Base_Test {
    using SafeERC20 for IERC20;

    uint256 internal constant AMOUNT = 100 * USDC_UNIT;

    function test_NoReturnToken_MovesWithSafeERC20AndBreaksABoolCaller() external {
        usdt.mint(address(this), AMOUNT);
        IERC20(address(usdt)).safeTransfer(users.alice, AMOUNT);
        assertEq(usdt.balanceOf(users.alice), 1_000_000 * USDC_UNIT + AMOUNT);

        // A caller that decodes the missing bool reverts.
        vm.expectRevert();
        this.boolTransferNoReturn();
    }

    function boolTransferNoReturn() external {
        vm.prank(users.amira);
        IERC20(address(usdt)).transfer(users.alice, AMOUNT);
    }

    function test_FalseReturnToken_MovesNothingAndSafeERC20Reverts() external {
        vm.prank(users.amira);
        assertFalse(falseToken.transfer(users.alice, AMOUNT));
        assertEq(falseToken.balanceOf(users.alice), 1_000_000 * USDC_UNIT);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(falseToken)));
        this.safeTransferFalse();
    }

    function safeTransferFalse() external {
        IERC20(address(falseToken)).safeTransfer(users.alice, AMOUNT);
    }

    function test_FeeOnTransferToken_DeliversLess() external {
        uint256 before = feeToken.balanceOf(users.alice);
        vm.prank(users.amira);
        feeToken.transfer(users.alice, AMOUNT);
        assertEq(feeToken.balanceOf(users.alice) - before, AMOUNT * 99 / 100);
    }

    function test_RebasingToken_DeliversShortAndRebases() external {
        uint256 before = rebasingToken.balanceOf(users.alice);
        vm.prank(users.amira);
        rebasingToken.transfer(users.alice, AMOUNT);
        assertEq(rebasingToken.balanceOf(users.alice) - before, AMOUNT - 1);

        uint256 held = rebasingToken.balanceOf(users.alice);
        rebasingToken.rebase(2.2e18);
        assertApproxEqAbs(rebasingToken.balanceOf(users.alice), held * 2, 2);
    }

    function test_ReentrantToken_CallsTheArmedTargetOnce() external {
        Reentered target = new Reentered();
        reentrantToken.arm(address(target), abi.encodeCall(Reentered.hit, ()));
        vm.startPrank(users.amira);
        reentrantToken.transfer(users.alice, AMOUNT);
        reentrantToken.transfer(users.alice, AMOUNT);
        vm.stopPrank();
        assertEq(target.hits(), 1);
        assertTrue(reentrantToken.reentered());
        assertTrue(reentrantToken.reentrySucceeded());
    }
}

contract Reentered {
    uint256 public hits;

    function hit() external {
        ++hits;
    }
}
