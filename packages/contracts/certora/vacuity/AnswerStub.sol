// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @notice Gate 11's vacuity probe: a TDD red stub whose only function reverts. `Answer.spec` passes
/// on it only vacuously, so `--rule_sanity basic` must flag it.
contract AnswerStub {
    error NotImplemented();

    /// @notice Reverts `NotImplemented()`.
    function get() external pure returns (uint256) {
        revert NotImplemented();
    }
}
