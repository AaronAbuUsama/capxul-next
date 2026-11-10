// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICaptable } from "../../../src/interfaces/ICaptable.sol";

/// @dev The Captable as a ShareClass sees it: the company Safe and the transfer check. Tests set what
/// `checkTransfer` answers; mint, burn and forcedMove are made by pranking as this contract.
contract MockCaptableForShareClass {
    enum Answer {
        Allow,
        NotAllowed,
        Locked
    }

    address public immutable safe;
    Answer public answer;
    uint128 public locked;

    constructor(address safe_) {
        safe = safe_;
    }

    function setAnswer(Answer answer_, uint128 locked_) external {
        answer = answer_;
        locked = locked_;
    }

    /// @dev As ICaptable.checkTransfer: view, reverts with the Captable's errors.
    function checkTransfer(uint8 classId, address from, address to, uint256) external view {
        if (answer == Answer.NotAllowed) revert ICaptable.TransferNotAllowed(classId, from, to);
        if (answer == Answer.Locked) revert ICaptable.SharesLocked(from, locked);
    }
}
