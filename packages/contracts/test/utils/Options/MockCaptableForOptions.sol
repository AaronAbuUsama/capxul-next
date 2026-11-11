// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICaptable } from "../../../src/interfaces/ICaptable.sol";
import { MockERC20 } from "../../mocks/MockERC20.sol";

/// @notice The Captable as Options sees it (spec/captable.md), small enough to trust: `safe`, `exits`, and
/// `issue` with the issuer allowance (spent by a module's issue), invariant E1 (`issued <= authorised`) and
/// ruling D6 (`ProposalPending` while a proposal in the class is pending). Each class's shares are a plain
/// 0-decimal `MockERC20`, because Options only needs the shares to arrive.
contract MockCaptableForOptions {
    address public immutable safe;
    address public immutable exits;

    mapping(uint8 classId => MockERC20) public token;
    mapping(uint8 classId => uint128) public authorised;
    mapping(uint8 classId => uint128) public issued;
    /// @dev Ruling D6 stand-in: a proposal in the class is pending until this time (0: none).
    mapping(uint8 classId => uint48) public pendingUntil;
    mapping(address module => mapping(uint8 classId => uint128)) public issuerAllowance;
    uint8 public numberOfClasses;

    constructor(address safe_, address exits_) {
        safe = safe_;
        exits = exits_;
    }

    /// @dev Test setup: a class with `authorised_` shares.
    function createClass(uint128 authorised_) external returns (uint8 classId) {
        classId = numberOfClasses++;
        token[classId] = new MockERC20("Acme Ltd Common", "ACME", 0);
        authorised[classId] = authorised_;
    }

    /// @dev Test setup: a proposal pending in the class until `until`.
    function setPendingUntil(uint8 classId, uint48 until) external {
        pendingUntil[classId] = until;
    }

    function setIssuerAllowance(address module, uint8 classId, uint128 amount) external {
        if (msg.sender != safe) revert ICaptable.OnlyBoard();
        issuerAllowance[module][classId] = amount;
    }

    function issue(uint8 classId, address to, uint128 amount, bytes32 reason) external {
        if (classId >= numberOfClasses) revert ICaptable.UnknownClass(classId);
        if (amount == 0) revert ICaptable.ZeroAmount();
        if (reason == bytes32(0)) revert ICaptable.ZeroReason();
        if (msg.sender != safe) {
            uint128 left = issuerAllowance[msg.sender][classId];
            if (left < amount) revert ICaptable.IssuerAllowanceExceeded(msg.sender, classId, left, amount);
            issuerAllowance[msg.sender][classId] = left - amount;
        }
        uint48 until = pendingUntil[classId];
        if (until != 0 && block.timestamp <= until) revert ICaptable.ProposalPending(classId, until);
        if (uint256(issued[classId]) + amount > authorised[classId]) {
            revert ICaptable.AuthorisedExceeded(classId, authorised[classId], issued[classId], amount);
        }
        issued[classId] += amount;
        token[classId].mint(to, amount);
    }
}
