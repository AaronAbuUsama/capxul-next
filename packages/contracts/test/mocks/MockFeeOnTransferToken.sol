// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { MockERC20 } from "./MockERC20.sol";

/// @dev An ERC-20 that burns a fee from every transfer, so the receiver gets less than was sent and
/// Payments must revert `InexactTransfer` (spec/payments.md). Mint and burn take no fee.
contract MockFeeOnTransferToken is MockERC20 {
    uint256 internal constant BPS = 10_000;

    /// @dev 100 = 1%. A test may set 0 to make the token exact again.
    uint256 public feeBps = 100;

    constructor() MockERC20("Fee Token", "FEE", 6) { }

    function setFeeBps(uint256 feeBps_) external {
        feeBps = feeBps_;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0)) return super._update(from, to, value);
        uint256 fee = value * feeBps / BPS;
        super._update(from, address(0), fee);
        super._update(from, to, value - fee);
    }
}
