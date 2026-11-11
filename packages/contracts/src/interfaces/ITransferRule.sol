// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @title ITransferRule
/// @notice A share class's Custom transfer rule (spec/captable.md). The Captable staticcalls it on every
/// transfer of that class; a false answer, a revert or running out of the call's gas refuses the transfer.
interface ITransferRule {
    /// @notice Whether `amount` shares of class `classId` may move from `from` to `to`.
    function allowed(uint8 classId, address from, address to, uint256 amount) external view returns (bool);
}
