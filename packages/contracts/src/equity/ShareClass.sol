// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {
    ERC20VotesUpgradeable
} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20VotesUpgradeable.sol";
import { EIP712Upgradeable } from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import { VotesUpgradeable } from "@openzeppelin/contracts-upgradeable/governance/utils/VotesUpgradeable.sol";
import { NoncesUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/NoncesUpgradeable.sol";
import { Checkpoints } from "@openzeppelin/contracts/utils/structs/Checkpoints.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { IERC5805 } from "@openzeppelin/contracts/interfaces/IERC5805.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IERC6372 } from "@openzeppelin/contracts/interfaces/IERC6372.sol";

import { ICaptable } from "../interfaces/ICaptable.sol";
import { IShareClass } from "../interfaces/IShareClass.sol";

/// @title ShareClass
/// @notice One ERC20Votes token per share class (docs/planning/protocol-v4/spec/share-class.md), an EIP-1167
/// clone of this implementation. Ported from Firm `EquityToken.sol`. Whole shares, timestamp clock, votes
/// self-delegated on first receipt, and (ruling D5) the company Safe's shares never vote and are
/// checkpointed so the Captable leaves them out of supply.
/// @dev Everything ERC20, votes, checkpoints and EIP-712 is OpenZeppelin (J9); only the overrides are ours.
contract ShareClass is IShareClass, ERC20VotesUpgradeable {
    using Checkpoints for Checkpoints.Trace208;

    address public captable;
    uint8 public classId;
    address public safe;
    Checkpoints.Trace208 private _safeBalance;

    /// @dev The implementation cannot be initialised (N-6).
    constructor() {
        _disableInitializers();
    }

    /// @inheritdoc IShareClass
    /// @dev No zero check: `captable_.safe()` below already reverts for an address with no code.
    function initialize(
        string calldata name_,
        string calldata symbol_,
        // forge-lint: disable-next-line(missing-zero-check)
        address captable_,
        uint8 classId_
    )
        external
        initializer
    {
        __ERC20_init(name_, symbol_);
        __EIP712_init(name_, "1");
        captable = captable_;
        classId = classId_;
        safe = ICaptable(captable_).safe();
    }

    modifier onlyCaptable() {
        if (msg.sender != captable) revert OnlyCaptable();
        _;
    }

    /// @inheritdoc IShareClass
    function mint(address to, uint256 amount) external onlyCaptable {
        _mint(to, amount);
    }

    /// @inheritdoc IShareClass
    function burn(address from, uint256 amount) external onlyCaptable {
        _burn(from, amount);
    }

    /// @inheritdoc IShareClass
    function forcedMove(address from, address to, uint256 amount) external onlyCaptable {
        _transfer(from, to, amount);
    }

    /// @inheritdoc IShareClass
    function safeBalanceAt(uint256 timepoint) external view returns (uint256) {
        if (timepoint > clock()) revert ERC5805FutureLookup(timepoint, clock());
        return _safeBalance.upperLookupRecent(SafeCast.toUint48(timepoint));
    }

    /// @notice Shares are whole.
    function decimals() public pure override(ERC20Upgradeable, IERC20Metadata) returns (uint8) {
        return 0;
    }

    /// @inheritdoc IERC6372
    function clock() public view override(IERC6372, VotesUpgradeable) returns (uint48) {
        return SafeCast.toUint48(block.timestamp);
    }

    /// @inheritdoc IERC6372
    // solhint-disable-next-line func-name-mixedcase
    function CLOCK_MODE() public pure override(IERC6372, VotesUpgradeable) returns (string memory) {
        return "mode=timestamp";
    }

    /// @dev Ordinary moves ask the Captable first; the Captable's own moves skip the check (T-4). The Safe's
    /// balance is checkpointed, and a holder with no delegate (the Safe excepted) delegates to itself (Q10).
    function _update(address from, address to, uint256 amount) internal override {
        if (from != address(0) && to != address(0) && msg.sender != captable) {
            ICaptable(captable).checkTransfer(classId, from, to, amount);
        }
        super._update(from, to, amount);
        address safe_ = safe;
        if (from == safe_ || to == safe_) {
            _safeBalance.push(clock(), SafeCast.toUint208(balanceOf(safe_)));
        }
        if (amount != 0 && to != address(0) && to != safe_ && delegates(to) == address(0)) _delegate(to, to);
    }

    /// @dev Covers `delegate` and `delegateBySig`: the Safe never votes and nobody lends it votes.
    function _delegate(address account, address delegatee) internal override {
        if (account == safe || delegatee == safe) revert SafeCannotVote();
        super._delegate(account, delegatee);
    }
}
