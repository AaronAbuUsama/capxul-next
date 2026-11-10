// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Ben donates tokens straight to Payments, which nothing can stop (research R2 4.1). P2 then
/// reads: Payments' balance of each token equals exactly what was donated, so no Payments call moved it.
contract PaymentsDonorHandler is Test {
    using SafeERC20 for IERC20;

    address internal immutable payments;
    address internal immutable donor;
    address[] internal tokens;

    mapping(address token => uint256) public donated;
    uint256 public donations;

    constructor(address payments_, address donor_, address[] memory tokens_) {
        payments = payments_;
        donor = donor_;
        tokens = tokens_;
    }

    function donate(uint256 tokenSeed, uint256 amount) external {
        address token = tokens[bound(tokenSeed, 0, tokens.length - 1)];
        uint256 balance = IERC20(token).balanceOf(donor);
        if (balance == 0) return;
        amount = bound(amount, 1, balance < 1000e6 ? balance : 1000e6);
        uint256 before = IERC20(token).balanceOf(payments);
        vm.prank(donor);
        IERC20(token).safeTransfer(payments, amount); // usdt returns nothing
        // What arrived, not what was sent: the fee token burns part of a donation.
        donated[token] += IERC20(token).balanceOf(payments) - before;
        donations++;
    }
}
