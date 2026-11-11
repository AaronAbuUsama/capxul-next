// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @notice A fee-on-transfer ERC-20 for rule P1_feeTokenReverts: `transferFrom` burns `feeOf(amount)`
/// from what reaches the receiver.
contract PaymentsFeeTokenHarness {
    mapping(address account => uint256) public balanceOf;
    mapping(address owner => mapping(address spender => uint256)) public allowance;
    uint256 public feeBps;

    function feeOf(uint256 amount) public view returns (uint256) {
        return amount * feeBps / 10_000;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount - feeOf(amount);
        return true;
    }
}
