// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @notice Gate 11's control: the implementation the vacuity spec verifies.
contract Answer {
    /// @notice Returns one.
    function get() external pure returns (uint256) {
        return 1;
    }
}
