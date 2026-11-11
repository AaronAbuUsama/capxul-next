// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { MockERC20 } from "./MockERC20.sol";

/// @dev A share-based rebasing ERC-20 (stETH-style). Balances are `shares * index / 1e18`; `rebase`
/// moves every balance at once. A transfer moves `floor(amount * 1e18 / index)` shares, so at any
/// index but 1e18 most amounts arrive short and Payments must revert `InexactTransfer`
/// (spec/payments.md). Allowances stay in token units.
contract MockRebasingToken is MockERC20 {
    uint256 internal constant ONE = 1e18;

    /// @dev Starts at 1.1: 100 USDC sent arrives as 99.999999.
    uint256 public index = 1.1e18;

    constructor() MockERC20("Rebasing Token", "REBASE", 6) { }

    function rebase(uint256 index_) external {
        index = index_;
    }

    function sharesOf(address account) external view returns (uint256) {
        return super.balanceOf(account);
    }

    function balanceOf(address account) public view override returns (uint256) {
        return super.balanceOf(account) * index / ONE;
    }

    function totalSupply() public view override returns (uint256) {
        return super.totalSupply() * index / ONE;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value * ONE / index);
    }
}
