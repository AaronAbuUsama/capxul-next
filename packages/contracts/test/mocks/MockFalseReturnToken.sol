// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @dev Ported from beta `packages/contracts/test/mocks/MockFalseReturnToken.sol`. An ERC-20 whose
/// `transfer` and `transferFrom` move nothing and return `false` instead of reverting, so a caller
/// must check the returned bool (SafeERC20 does).
contract MockFalseReturnToken {
    string public constant name = "False Return Token";
    string public constant symbol = "FALSE";
    uint8 public constant decimals = 6;
    uint256 public totalSupply;
    mapping(address account => uint256) public balanceOf;
    mapping(address owner => mapping(address spender => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }
}
