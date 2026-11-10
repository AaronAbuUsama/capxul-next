// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { Checkpoints } from "@openzeppelin/contracts/utils/structs/Checkpoints.sol";

import { ICaptable } from "../interfaces/ICaptable.sol";
import { IGovernor } from "../interfaces/IGovernor.sol";
import { IShareClass } from "../interfaces/IShareClass.sol";
import { ITransferRule } from "../interfaces/ITransferRule.sol";
import { IVesting } from "../interfaces/IVesting.sol";

/// @title Captable
/// @notice One registry per company holding every share class (spec/captable.md). Ported from Firm
/// `Captable.sol`, with the bouncer rules folded into `checkTransfer`. One EIP-1167 clone per company.
/// @dev Whole-share maths: votes are `weight * votes * oip / conversionPrice`, rounded down once per class.
contract Captable is ICaptable {
    using Checkpoints for Checkpoints.Trace208;

    /// @dev OpenZeppelin's `Votes` error for a lookup at or after the clock.
    error ERC5805FutureLookup(uint256 timepoint, uint48 clock);

    /// @inheritdoc ICaptable
    uint8 public constant MAX_CLASSES = 32;
    /// @inheritdoc ICaptable
    uint256 public constant MAX_CLASS_VOTES = 2 ** 200;
    /// @inheritdoc ICaptable
    uint8 public constant PRICE_DECIMALS = 6;
    /// @inheritdoc ICaptable
    uint256 public constant CUSTOM_RULE_GAS = 100_000;
    /// @inheritdoc ICaptable
    uint8 public constant NONE = type(uint8).max;

    /// @inheritdoc ICaptable
    string public name;
    /// @inheritdoc ICaptable
    address public safe;
    /// @inheritdoc ICaptable
    address public governor;
    /// @inheritdoc ICaptable
    address public vesting;
    /// @inheritdoc ICaptable
    address public options;
    /// @inheritdoc ICaptable
    address public rounds;
    /// @inheritdoc ICaptable
    address public exits;
    /// @inheritdoc ICaptable
    address public shareClassImpl;
    /// @inheritdoc ICaptable
    bool public closedForExit;
    /// @inheritdoc ICaptable
    mapping(address module => mapping(uint8 classId => uint128)) public issuerAllowance;
    /// @inheritdoc ICaptable
    mapping(bytes32 consentId => bool) public transferConsent;

    bool private _initialized;
    Class[] private _classes;
    /// @dev Only lowered prices are checkpointed; before the first one the price is the original issue price.
    mapping(uint8 classId => Checkpoints.Trace208) private _conversionPrice;

    /// @dev N-6: the implementation can never be initialised.
    constructor() {
        _initialized = true;
    }

    modifier onlyBoard() {
        if (msg.sender != safe) revert OnlyBoard();
        _;
    }

    modifier onlyGovernor() {
        if (msg.sender != governor) revert OnlyGovernor();
        _;
    }

    modifier known(uint8 classId) {
        if (classId >= _classes.length) revert UnknownClass(classId);
        _;
    }

    // Every external call below goes to a ShareClass clone this Captable made, to Vesting or to a Governor (the
    // company's own contracts), and every loop runs over at most MAX_CLASSES of those clones (C-15).
    // forge-lint: disable-start(calls-loop, reentrancy-events)

    // ------------------------------------------------------------------------------------------------
    // Setup and reserved matters
    // ------------------------------------------------------------------------------------------------

    /// @inheritdoc ICaptable
    function initialize(
        string calldata companyName,
        Wiring calldata w,
        ClassParams[] calldata initialClasses
    )
        external
    {
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;
        if (
            w.safe == address(0) || w.governor == address(0) || w.vesting == address(0) || w.options == address(0)
                || w.rounds == address(0) || w.exits == address(0) || w.shareClassImpl == address(0)
        ) revert InvalidClass("wiring");
        name = companyName;
        safe = w.safe;
        governor = w.governor;
        vesting = w.vesting;
        options = w.options;
        rounds = w.rounds;
        exits = w.exits;
        shareClassImpl = w.shareClassImpl;
        for (uint256 i; i < initialClasses.length; ++i) {
            _create(initialClasses[i]);
        }
    }

    /// @inheritdoc ICaptable
    function createClass(ClassParams calldata p) external onlyGovernor returns (uint8) {
        return _create(p);
    }

    /// @inheritdoc ICaptable
    function setAuthorised(uint8 classId, uint128 amount) external onlyGovernor known(classId) {
        Class storage c = _classes[classId];
        if (c.frozen) revert FrozenClass(classId);
        _checkVotesBound(classId, c.weight, amount, c.originalIssuePrice, c.conversionFloorPrice);
        c.authorised = amount;
        _checkRoom(classId, 0);
        if (c.convertsInto != NONE) _checkRoom(c.convertsInto, 0);
        emit AuthorisedSet(classId, amount);
    }

    /// @inheritdoc ICaptable
    function setTransferRule(uint8 classId, TransferRule rule, address customRule)
        external
        onlyGovernor
        known(classId)
    {
        Class storage c = _classes[classId];
        if (c.frozen) revert FrozenClass(classId);
        if (rule == TransferRule.Custom && customRule == address(0)) revert InvalidClass("customRule");
        c.rule = rule;
        c.customRule = customRule; // consulted only while the rule is Custom
        emit TransferRuleSet(classId, rule, customRule);
    }

    /// @inheritdoc ICaptable
    function freeze(uint8 classId) external onlyGovernor known(classId) {
        Class storage c = _classes[classId];
        if (c.frozen) revert FrozenClass(classId);
        c.frozen = true;
        emit ClassFrozen(classId);
    }

    /// @inheritdoc ICaptable
    function setClassGovernor(uint8 classId, address classGovernor_) external onlyGovernor known(classId) {
        Class storage c = _classes[classId];
        if (c.classGovernor != address(0)) revert InvalidClass("classGovernor set");
        if (classGovernor_ == address(0)) revert InvalidClass("classGovernor zero");
        c.classGovernor = classGovernor_;
        emit ClassGovernorSet(classId, classGovernor_);
    }

    /// @inheritdoc ICaptable
    function forcedTransfer(uint8 classId, address from, address to, uint128 amount, bytes32 reason) external {
        // The caller first, then the class (the forcedTransfer tree's order).
        bool voted = msg.sender == governor;
        if (!voted && msg.sender != safe && msg.sender != exits) revert OnlyBoard();
        if (classId >= _classes.length) revert UnknownClass(classId);
        if (reason == bytes32(0)) revert ZeroReason();
        _requireUnlocked(classId, from, amount);
        if (!voted) {
            bytes32 id = keccak256(abi.encode(classId, from, to, amount, reason));
            if (!transferConsent[id]) revert ConsentMissing();
            delete transferConsent[id];
        }
        _classes[classId].token.forcedMove(from, to, amount);
        emit ForcedTransfer(classId, from, to, amount, reason);
    }

    // ------------------------------------------------------------------------------------------------
    // Shareholders
    // ------------------------------------------------------------------------------------------------

    /// @inheritdoc ICaptable
    function consentToTransfer(uint8 classId, address to, uint128 amount, bytes32 reason) external known(classId) {
        if (reason == bytes32(0)) revert ZeroReason();
        if (amount == 0) revert ZeroAmount();
        bytes32 id = keccak256(abi.encode(classId, msg.sender, to, amount, reason));
        transferConsent[id] = true;
        emit TransferConsented(id, classId, msg.sender, to, amount, reason);
    }

    /// @inheritdoc ICaptable
    function convert(uint8 classId, uint128 amount) external known(classId) {
        Class storage c = _classes[classId];
        uint8 target = c.convertsInto;
        if (target == NONE) revert NotConvertible(classId);
        _requireUnlocked(classId, msg.sender, amount);
        uint256 minted = _scale(classId, amount, block.timestamp); // amount * oip / conversionPrice, rounded down
        c.authorised -= amount; // N-5: the source's authorised falls with the shares burned
        c.token.burn(msg.sender, amount);
        _classes[target].token.mint(msg.sender, minted);
        emit Converted(msg.sender, classId, target, amount, SafeCast.toUint128(minted));
    }

    // ------------------------------------------------------------------------------------------------
    // The Board and modules
    // ------------------------------------------------------------------------------------------------

    /// @inheritdoc ICaptable
    function issue(uint8 classId, address to, uint128 amount, bytes32 reason) external {
        bool board = msg.sender == safe;
        if (!board && msg.sender != options && msg.sender != rounds && msg.sender != vesting) revert OnlyBoard();
        if (classId >= _classes.length) revert UnknownClass(classId);
        // The checks in the order spec/captable.md lists them: amount, closed, D6, then the module's allowance
        // and E1 (the issue tree's "when the caller may issue now").
        if (amount == 0) revert ZeroAmount();
        if (closedForExit) revert CaptableClosed();
        Class storage c = _classes[classId];
        // Ruling D6 (F6): no issuance from a proposal's creation to its snapshot.
        if (c.weight > 0) _requireNoPending(classId, governor);
        if (c.classGovernor != address(0)) _requireNoPending(classId, c.classGovernor);
        if (!board) {
            uint128 left = issuerAllowance[msg.sender][classId];
            if (left < amount) revert IssuerAllowanceExceeded(msg.sender, classId, left, amount);
        }
        uint256 used = c.token.totalSupply() + convertibleReserved(classId);
        if (used + amount > c.authorised) {
            revert AuthorisedExceeded(classId, c.authorised, SafeCast.toUint128(used), amount);
        }
        if (!board) issuerAllowance[msg.sender][classId] -= amount;
        c.token.mint(to, amount);
        emit Issued(classId, to, amount, reason);
    }

    /// @inheritdoc ICaptable
    function setIssuerAllowance(address module, uint8 classId, uint128 amount) external onlyBoard {
        // The module, then the class (the setIssuerAllowance tree's order).
        if (module != options && module != rounds && module != vesting) revert OnlyModule();
        if (classId >= _classes.length) revert UnknownClass(classId);
        issuerAllowance[module][classId] = amount;
        emit IssuerAllowanceSet(module, classId, amount);
    }

    /// @inheritdoc ICaptable
    function setConversionPrice(uint8 classId, uint128 price) external known(classId) {
        if (msg.sender != governor && msg.sender != rounds) revert OnlyGovernor();
        Class storage c = _classes[classId];
        if (c.originalIssuePrice == 0) revert NotConvertible(classId);
        uint128 current = _priceAt(classId, c.originalIssuePrice, block.timestamp);
        if (price >= current) revert ConversionPriceNotLower(current, price);
        if (price < c.conversionFloorPrice) revert BelowFloor(c.conversionFloorPrice, price);
        _conversionPrice[classId].push(SafeCast.toUint48(block.timestamp), price);
        emit ConversionPriceSet(classId, price);
    }

    /// @inheritdoc ICaptable
    function burnUnvested(uint8 classId, address from, uint128 amount) external known(classId) {
        if (msg.sender != vesting) revert OnlyModule();
        _classes[classId].token.burn(from, amount);
        emit BurnedUnvested(classId, from, amount);
    }

    /// @inheritdoc ICaptable
    function burnForExit(uint8 classId, address from, uint128 amount) external known(classId) {
        if (msg.sender != exits) revert OnlyModule();
        _classes[classId].token.burn(from, amount);
        emit BurnedForExit(classId, from, amount);
    }

    /// @inheritdoc ICaptable
    function closeForExit() external {
        if (msg.sender != exits) revert OnlyModule();
        closedForExit = true;
        emit ClosedForExit();
    }

    /// @inheritdoc ICaptable
    function checkTransfer(uint8 classId, address from, address to, uint256 amount) external view known(classId) {
        Class storage c = _classes[classId];
        if (msg.sender != address(c.token)) revert OnlyModule();
        // C-25: the lock first, compared without subtracting, so amount > balance is a clean revert.
        _requireUnlockedAmount(c.token.balanceOf(from), from, _locked(classId, from), amount);
        if (!_ruleAllows(c, classId, from, to, amount)) revert TransferNotAllowed(classId, from, to);
    }

    // ------------------------------------------------------------------------------------------------
    // Reads
    // ------------------------------------------------------------------------------------------------

    /// @inheritdoc ICaptable
    function numberOfClasses() external view returns (uint8) {
        return SafeCast.toUint8(_classes.length);
    }

    /// @inheritdoc ICaptable
    function getClass(uint8 classId) external view known(classId) returns (Class memory) {
        return _classes[classId];
    }

    /// @inheritdoc ICaptable
    function conversionPriceAt(uint8 classId, uint256 timepoint) external view known(classId) returns (uint128) {
        return _priceAt(classId, _classes[classId].originalIssuePrice, timepoint);
    }

    /// @inheritdoc ICaptable
    function convertibleReserved(uint8 classId) public view returns (uint256 reserved) {
        for (uint256 i; i < _classes.length; ++i) {
            Class storage s = _classes[i];
            if (s.convertsInto == classId) {
                reserved += _reserveOf(s.authorised, s.originalIssuePrice, s.conversionFloorPrice);
            }
        }
    }

    // ------------------------------------------------------------------------------------------------
    // Votes (IERC5805 on the timestamp clock; E3, D5)
    // ------------------------------------------------------------------------------------------------

    /// @notice The clock: `block.timestamp`.
    function clock() public view returns (uint48) {
        return SafeCast.toUint48(block.timestamp);
    }

    /// @notice "mode=timestamp".
    // forge-lint: disable-next-line(mixed-case-function)
    function CLOCK_MODE() external pure returns (string memory) {
        return "mode=timestamp";
    }

    /// @notice The account's weighted, as-converted votes now.
    function getVotes(address account) external view returns (uint256 total) {
        for (uint8 i; i < _classes.length; ++i) {
            Class storage c = _classes[i];
            if (c.weight == 0) continue;
            total += _scale(i, uint256(c.weight) * c.token.getVotes(account), block.timestamp);
        }
    }

    /// @notice The account's weighted, as-converted votes at a past timepoint (E3); the Safe's are 0 (D5).
    function getPastVotes(address account, uint256 timepoint) external view returns (uint256 total) {
        _requirePast(timepoint);
        for (uint8 i; i < _classes.length; ++i) {
            Class storage c = _classes[i];
            if (c.weight == 0) continue;
            total += _scale(i, uint256(c.weight) * c.token.getPastVotes(account, timepoint), timepoint);
        }
    }

    /// @notice The weighted, as-converted supply at a past timepoint, without the Safe's shares (D5).
    function getPastTotalSupply(uint256 timepoint) external view returns (uint256 total) {
        _requirePast(timepoint);
        for (uint8 i; i < _classes.length; ++i) {
            Class storage c = _classes[i];
            if (c.weight == 0) continue;
            uint256 shares = c.token.getPastTotalSupply(timepoint) - c.token.safeBalanceAt(timepoint);
            total += _scale(i, uint256(c.weight) * shares, timepoint);
        }
    }

    /// @notice Not used: delegation lives on each class token.
    function delegates(address) external pure returns (address) {
        return address(0);
    }

    /// @notice Reverts `DelegateOnClassToken`: delegate on each class token.
    function delegate(address) external pure {
        revert DelegateOnClassToken();
    }

    /// @notice Reverts `DelegateOnClassToken`: delegate on each class token.
    function delegateBySig(address, uint256, uint256, uint8, bytes32, bytes32) external pure {
        revert DelegateOnClassToken();
    }

    // ------------------------------------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------------------------------------

    // `initialize` creates the template's classes in a loop: the first bad class aborts the whole install.
    // forge-lint: disable-start(require-revert-in-loop)

    function _create(ClassParams calldata p) private returns (uint8 classId) {
        if (_classes.length >= MAX_CLASSES) revert TooManyClasses();
        classId = SafeCast.toUint8(_classes.length);
        if (p.authorised == 0) revert InvalidClass("authorised");
        if (p.convertsInto != NONE && p.convertsInto >= classId) revert InvalidClass("convertsInto");
        // A class with no issue price (Common) has no preference, converts one for one and never reads its floor.
        if (p.originalIssuePrice == 0) {
            if (p.preferenceMultipleBps != 0) revert InvalidClass("preference");
        } else if (p.conversionFloorPrice == 0 || p.conversionFloorPrice > p.originalIssuePrice) {
            revert InvalidClass("floor");
        }
        if (p.rule == TransferRule.Custom && p.customRule == address(0)) revert InvalidClass("customRule");
        _checkVotesBound(classId, p.weight, p.authorised, p.originalIssuePrice, p.conversionFloorPrice);
        if (p.convertsInto != NONE) {
            _checkRoom(p.convertsInto, _reserveOf(p.authorised, p.originalIssuePrice, p.conversionFloorPrice));
        }

        address token = Clones.clone(shareClassImpl);
        IShareClass(token).initialize(string.concat(name, " ", p.name), p.ticker, address(this), classId);
        Class storage c = _classes.push();
        c.token = IShareClass(token);
        c.weight = p.weight;
        c.convertsInto = p.convertsInto;
        c.rule = p.rule;
        c.customRule = p.customRule; // consulted only while the rule is Custom
        c.authorised = p.authorised;
        c.originalIssuePrice = p.originalIssuePrice;
        c.conversionFloorPrice = p.conversionFloorPrice;
        c.preferenceMultipleBps = p.preferenceMultipleBps;
        c.participating = p.participating;
        c.seniority = p.seniority;
        c.termsHash = p.termsHash;
        emit ClassCreated(classId, token, p);
    }

    /// @dev E1 for one class: supply + convertible reserve (+ `extra`) must fit in authorised. A new class's
    /// reserve can be far past uint128 (it can never fit), so the amount reported saturates instead of panicking.
    function _checkRoom(uint8 classId, uint256 extra) private view {
        Class storage c = _classes[classId];
        uint256 used = c.token.totalSupply() + convertibleReserved(classId) + extra;
        if (used > c.authorised) {
            revert AuthorisedExceeded(classId, c.authorised, SafeCast.toUint128(Math.min(used, type(uint128).max)), 0);
        }
    }

    /// @dev E9: weight * authorised * (oip / floor) <= 2**200, without overflowing on the way.
    function _checkVotesBound(
        uint8 classId,
        uint16 weight,
        uint128 authorised,
        uint128 oip,
        uint128 floor
    )
        private
        pure
    {
        uint256 base = uint256(weight) * authorised; // below 2**144: a class with no issue price is always within
        if (oip == 0) return;
        (uint256 high,) = Math.mul512(base, oip);
        if (high >= floor || Math.mulDiv(base, oip, floor) > MAX_CLASS_VOTES) revert VotesBoundExceeded(classId);
    }

    // forge-lint: disable-end(require-revert-in-loop)

    /// @dev ceil(authorised * oip / floor); a class with no issue price converts one for one.
    function _reserveOf(uint128 authorised, uint128 oip, uint128 floor) private pure returns (uint256) {
        if (oip == 0) return authorised;
        return Math.mulDiv(authorised, oip, floor, Math.Rounding.Ceil);
    }

    function _priceAt(uint8 classId, uint128 oip, uint256 timepoint) private view returns (uint128) {
        uint208 p = _conversionPrice[classId].upperLookupRecent(SafeCast.toUint48(timepoint));
        return p == 0 ? oip : SafeCast.toUint128(p);
    }

    /// @dev `x * oip / conversionPrice(t)`, rounded down; a class with no issue price has ratio 1.
    function _scale(uint8 classId, uint256 x, uint256 t) private view returns (uint256) {
        uint128 oip = _classes[classId].originalIssuePrice;
        if (oip == 0 || x == 0) return x;
        return Math.mulDiv(x, oip, _priceAt(classId, oip, t));
    }

    function _requirePast(uint256 timepoint) private view {
        uint48 now_ = clock();
        if (timepoint >= now_) revert ERC5805FutureLookup(timepoint, now_);
    }

    /// @dev Ruling D6 (F6): the window closes at the proposal's snapshot, a timestamp the Governor set on this
    /// same clock, so a validator's seconds of drift move nothing that matters.
    function _requireNoPending(uint8 classId, address gov) private view {
        uint48 until = IGovernor(gov).pendingUntil();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp <= until) revert ProposalPending(classId, until);
    }

    function _locked(uint8 classId, address account) private view returns (uint128) {
        return IVesting(vesting).lockedOf(address(this), classId, account, SafeCast.toUint64(block.timestamp));
    }

    function _requireUnlocked(uint8 classId, address account, uint128 amount) private view {
        uint128 locked = _locked(classId, account);
        _requireUnlockedAmount(_classes[classId].token.balanceOf(account), account, locked, amount);
    }

    /// @dev C-25: `amount` must fit in `balance - locked`. Never adds, so `amount = type(uint256).max` cannot
    /// overflow, and never subtracts before checking, so `amount > balance` is a clean revert.
    function _requireUnlockedAmount(uint256 balance, address account, uint128 locked, uint256 amount) private pure {
        if (locked > balance || amount > balance - locked) revert SharesLocked(account, locked);
    }

    /// @dev The class rule (Firm `BouncerChecker`'s embedded bouncers, BC-1 to BC-4, plus `Custom`). `DenyAll`
    /// refuses everything.
    function _ruleAllows(
        Class storage c,
        uint8 classId,
        address from,
        address to,
        uint256 amount
    )
        private
        view
        returns (bool)
    {
        TransferRule rule = c.rule;
        if (rule == TransferRule.AllowAll) return true;
        if (rule == TransferRule.ToClassShareholders) return c.token.balanceOf(to) > 0;
        if (rule == TransferRule.ToAnyShareholder) {
            for (uint8 i; i < _classes.length; ++i) {
                if (_classes[i].token.balanceOf(to) > 0) return true;
            }
            return false;
        }
        if (rule == TransferRule.Custom) return _customAllows(c.customRule, classId, from, to, amount);
        return false;
    }

    /// @dev C-28: a gas-capped staticcall reading exactly one word; a revert, other data or running out of gas
    /// refuses. The return data is never copied beyond 32 bytes.
    function _customAllows(
        address rule,
        uint8 classId,
        address from,
        address to,
        uint256 amount
    )
        private
        view
        returns (bool ok)
    {
        bytes memory data = abi.encodeCall(ITransferRule.allowed, (classId, from, to, amount));
        uint256 gas_ = CUSTOM_RULE_GAS;
        assembly ("memory-safe") {
            let success := staticcall(gas_, rule, add(data, 0x20), mload(data), 0, 0x20)
            ok := and(and(success, eq(returndatasize(), 0x20)), eq(mload(0), 1))
        }
    }

    // forge-lint: disable-end(calls-loop, reentrancy-events)
}
