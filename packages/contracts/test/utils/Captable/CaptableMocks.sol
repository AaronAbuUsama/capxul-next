// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import {
    ERC20VotesUpgradeable
} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20VotesUpgradeable.sol";
import { Checkpoints } from "@openzeppelin/contracts/utils/structs/Checkpoints.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { ICaptable } from "../../../src/interfaces/ICaptable.sol";
import { ITransferRule } from "../../../src/interfaces/ITransferRule.sol";

/// @notice A stand-in for the W3 ShareClass (spec/share-class.md) so the Captable can be tested before it
/// lands: an EIP-1167-cloneable ERC20Votes, 0 decimals, timestamp clock, `checkTransfer` on every ordinary
/// transfer, self-delegation on first receipt except the Safe's, and a checkpoint of the Safe's balance.
contract MockShareClass is ERC20VotesUpgradeable {
    using Checkpoints for Checkpoints.Trace208;

    error OnlyCaptable();
    error SafeCannotVote();

    address public captable;
    uint8 public classId;
    address public safe;
    bool private _captableMove;
    Checkpoints.Trace208 private _safeBalance;

    constructor() {
        _disableInitializers();
    }

    function initialize(
        string calldata name_,
        string calldata symbol_,
        address captable_,
        uint8 classId_
    )
        external
        initializer
    {
        __ERC20_init(name_, symbol_);
        __EIP712_init(name_, "1");
        __ERC20Votes_init();
        captable = captable_;
        classId = classId_;
        safe = ICaptable(captable_).safe();
    }

    modifier onlyCaptable() {
        if (msg.sender != captable) revert OnlyCaptable();
        _;
    }

    function decimals() public pure override returns (uint8) {
        return 0;
    }

    function clock() public view override returns (uint48) {
        return SafeCast.toUint48(block.timestamp);
    }

    // solhint-disable-next-line func-name-mixedcase
    function CLOCK_MODE() public pure override returns (string memory) {
        return "mode=timestamp";
    }

    function mint(address to, uint256 amount) external onlyCaptable {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyCaptable {
        _burn(from, amount);
    }

    function forcedMove(address from, address to, uint256 amount) external onlyCaptable {
        _captableMove = true;
        _transfer(from, to, amount);
        _captableMove = false;
    }

    function safeBalanceAt(uint256 timepoint) external view returns (uint256) {
        if (timepoint >= block.timestamp) return balanceOf(safe);
        return _safeBalance.upperLookupRecent(SafeCast.toUint48(timepoint));
    }

    function delegate(address delegatee) public override {
        if (msg.sender == safe || delegatee == safe) revert SafeCannotVote();
        super.delegate(delegatee);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && !_captableMove) {
            ICaptable(captable).checkTransfer(classId, from, to, value);
        }
        super._update(from, to, value);
        if (from == safe || to == safe) _safeBalance.push(clock(), SafeCast.toUint208(balanceOf(safe)));
        if (to != address(0) && to != safe && delegates(to) == address(0)) _delegate(to, to);
    }
}

/// @notice A stand-in for the company Governor (W5) or a class Governor: only `pendingUntil` (ruling D6).
contract MockCaptableGovernor {
    uint48 public pendingUntil;

    function setPendingUntil(uint48 until) external {
        pendingUntil = until;
    }
}

/// @notice A stand-in for the shared Vesting contract (W4): a settable locked amount per account and class.
contract MockVesting {
    mapping(address captable => mapping(uint8 classId => mapping(address account => uint128))) public locked;

    function setLocked(address captable, uint8 classId, address account, uint128 amount) external {
        locked[captable][classId][account] = amount;
    }

    function lockedOf(address captable, uint8 classId, address account, uint64) external view returns (uint128) {
        return locked[captable][classId][account];
    }
}

/// @notice A `Custom` transfer rule that answers as the test sets it, including the hostile answers (C-28).
contract MockTransferRule is ITransferRule {
    enum Mode {
        Allow,
        Deny,
        Revert,
        Malformed,
        BurnGas
    }

    Mode public mode;

    function setMode(Mode mode_) external {
        mode = mode_;
    }

    function allowed(uint8, address, address, uint256) external view returns (bool) {
        Mode m = mode;
        if (m == Mode.Allow) return true;
        if (m == Mode.Deny) return false;
        if (m == Mode.Revert) revert("rule says no");
        if (m == Mode.Malformed) {
            // A return of 2 where a bool is expected, and nothing else.
            assembly ("memory-safe") {
                mstore(0, 2)
                return(0, 32)
            }
        }
        // Burns every unit of gas it is given.
        uint256 x;
        for (uint256 i; i < type(uint256).max; ++i) {
            x = uint256(keccak256(abi.encode(x, i)));
        }
        return x == 0;
    }
}
