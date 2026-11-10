// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @title IMultiSend
/// @notice MultiSendCallOnly 1.4.1 (0x9641d764fc13c8B624c04430C7356C1C7C8102e2), which the company Safe
/// delegatecalls for an install batch, and MultiSend 1.4.1 (0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526), which a
/// personal Safe's setup delegatecalls. Both have this one function.
interface IMultiSend {
    /// @notice Runs packed transactions in order and reverts if any fails. Each is
    /// `uint8 operation ++ address to ++ uint256 value ++ uint256 dataLength ++ bytes data`; MultiSendCallOnly
    /// refuses operation 1 (delegatecall).
    /// @param transactions The packed transactions.
    function multiSend(bytes memory transactions) external payable;
}
