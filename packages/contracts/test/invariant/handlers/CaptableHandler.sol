// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { ICaptable } from "../../../src/interfaces/ICaptable.sol";
import { MockCaptableGovernor, MockShareClass, MockVesting } from "../../utils/Captable/CaptableMocks.sol";

/// @notice The honest side of the Captable invariant suite (invariants.md, "Handlers"): the Board (the Safe)
/// issues, the company Governor creates classes, sets authorised, freezes, lowers prices and votes forced
/// transfers, Rounds lowers prices, Vesting burns unvested shares, and the shareholders (Amira, Ben, Alice, Bob,
/// the investor) transfer, convert and consent. Every input is bounded so a correct Captable never reverts
/// (`fail_on_revert = true`). Ghosts: every balance, every class's authorised and price, and past votes.
contract CaptableHandler is Test {
    struct Record {
        address account;
        uint48 timepoint;
        uint256 votes;
    }

    uint8 internal constant NONE = type(uint8).max;
    uint8 internal constant MAX_HANDLER_CLASSES = 6;
    uint256 internal constant MAX_RECORDS = 64;

    ICaptable public immutable captable;
    MockCaptableGovernor public immutable governor;
    MockVesting public immutable vesting;
    address public immutable safe;
    address public immutable exits;
    address public immutable rounds;
    address[] internal _shareholders;

    bool internal _synced;
    mapping(uint8 classId => mapping(address account => uint256)) public ghostBalance;
    mapping(uint8 classId => uint256) public ghostAuthorised;
    mapping(uint8 classId => uint128) public ghostPrice;
    Record[] internal _records;
    Record[] internal _supplyRecords;
    mapping(bytes32 name => uint256) public calls;

    constructor(
        ICaptable captable_,
        MockCaptableGovernor governor_,
        MockVesting vesting_,
        address safe_,
        address exits_,
        address rounds_,
        address[] memory shareholders_
    ) {
        captable = captable_;
        governor = governor_;
        vesting = vesting_;
        safe = safe_;
        exits = exits_;
        rounds = rounds_;
        _shareholders = shareholders_;
    }

    /// @dev Reads the template classes once. `setUp` calls it, and the first honest call repeats it harmlessly,
    /// so a run in which only the attacker acts still compares against the template's ghosts.
    function sync() public {
        if (_synced) return;
        _synced = true;
        for (uint8 c; c < captable.numberOfClasses(); ++c) {
            ICaptable.Class memory cl = captable.getClass(c);
            ghostAuthorised[c] = cl.authorised;
            ghostPrice[c] = cl.originalIssuePrice;
        }
    }

    modifier synced(bytes32 name) {
        sync();
        ++calls[name];
        _;
    }

    // ------------------------------------------------------------------------------------------------
    // Reads for the invariants
    // ------------------------------------------------------------------------------------------------

    function shareholders() external view returns (address[] memory) {
        return _shareholders;
    }

    function holders() public view returns (address[] memory all) {
        all = new address[](_shareholders.length + 1);
        for (uint256 i; i < _shareholders.length; ++i) {
            all[i] = _shareholders[i];
        }
        all[_shareholders.length] = safe;
    }

    function records() external view returns (Record[] memory) {
        return _records;
    }

    function supplyRecords() external view returns (Record[] memory) {
        return _supplyRecords;
    }

    // ------------------------------------------------------------------------------------------------
    // The Board and the modules
    // ------------------------------------------------------------------------------------------------

    function issue(uint256 classSeed, uint256 toSeed, uint256 amount, bool toSafe) external synced("issue") {
        uint8 c = _class(classSeed);
        ICaptable.Class memory cl = captable.getClass(c);
        // D6: honest issuance waits for the snapshot of a pending proposal.
        if (cl.weight > 0 && vm.getBlockTimestamp() <= governor.pendingUntil()) {
            _warpTo(uint256(governor.pendingUntil()) + 1);
        }
        uint256 room = _room(c, cl);
        if (room == 0) return;
        address to = toSafe ? safe : _pick(toSeed);
        amount = bound(amount, 1, Math.min(room, 1e9));
        vm.prank(safe);
        captable.issue(c, to, uint128(amount), keccak256("issue"));
        ghostBalance[c][to] += amount;
    }

    function createClass(
        uint256 weight,
        uint256 authorised,
        uint256 oip,
        uint256 floorBps,
        uint256 targetSeed,
        uint256 ruleSeed
    )
        external
        synced("createClass")
    {
        uint8 n = captable.numberOfClasses();
        if (n >= MAX_HANDLER_CLASSES) return;
        ICaptable.ClassParams memory p;
        p.name = "Class";
        p.ticker = "CLS";
        p.weight = uint16(bound(weight, 0, 10));
        p.authorised = uint128(bound(authorised, 1, 1e9));
        p.rule = ICaptable.TransferRule(bound(ruleSeed, 0, 3));
        p.convertsInto = NONE;
        p.termsHash = keccak256("terms");
        oip = bound(oip, 0, 1e8);
        if (oip > 0) {
            p.originalIssuePrice = uint128(oip);
            p.conversionFloorPrice = uint128(Math.max(1, oip * bound(floorBps, 1, 10_000) / 10_000));
            p.preferenceMultipleBps = 10_000;
        }
        // Converting into an existing class, within its room: a priced class reserves at its highest ratio
        // (oip / floor); a class with no issue price converts one for one (spec/captable.md).
        if (targetSeed % 2 == 1) {
            uint8 t = uint8(targetSeed % n);
            uint256 room = _room(t, captable.getClass(t));
            uint256 maxAuthorised = oip == 0 ? room : room * p.conversionFloorPrice / oip;
            if (maxAuthorised > 0) {
                p.convertsInto = t;
                p.authorised = uint128(bound(p.authorised, 1, maxAuthorised));
            }
        }
        vm.prank(address(governor));
        uint8 id = captable.createClass(p);
        ghostAuthorised[id] = p.authorised;
        ghostPrice[id] = p.originalIssuePrice;
    }

    function setAuthorised(uint256 classSeed, uint256 amount) external synced("setAuthorised") {
        uint8 c = _class(classSeed);
        ICaptable.Class memory cl = captable.getClass(c);
        if (cl.frozen) return;
        uint256 min = Math.max(1, cl.token.totalSupply() + captable.convertibleReserved(c));
        uint256 max = min + 1e9;
        if (cl.convertsInto != NONE) {
            uint256 maxReserve = _reserveOf(cl) + _room(cl.convertsInto, captable.getClass(cl.convertsInto));
            max = Math.min(
                max,
                cl.originalIssuePrice == 0 ? maxReserve : maxReserve * cl.conversionFloorPrice / cl.originalIssuePrice
            );
        }
        if (min > max) return;
        amount = bound(amount, min, max);
        vm.prank(address(governor));
        captable.setAuthorised(c, uint128(amount));
        ghostAuthorised[c] = amount;
    }

    function freeze(uint256 classSeed) external synced("freeze") {
        uint8 c = _class(classSeed);
        if (captable.getClass(c).frozen) return;
        vm.prank(address(governor));
        captable.freeze(c);
    }

    function lowerPrice(uint256 classSeed, uint256 price, bool byRounds) external synced("lowerPrice") {
        uint8 c = _class(classSeed);
        ICaptable.Class memory cl = captable.getClass(c);
        if (cl.originalIssuePrice == 0) return;
        uint128 current = captable.conversionPriceAt(c, vm.getBlockTimestamp());
        if (current == cl.conversionFloorPrice) return;
        price = bound(price, cl.conversionFloorPrice, current - 1);
        vm.prank(byRounds ? rounds : address(governor));
        captable.setConversionPrice(c, uint128(price));
        ghostPrice[c] = uint128(price);
    }

    function burnUnvested(uint256 classSeed, uint256 fromSeed, uint256 amount) external synced("burnUnvested") {
        uint8 c = _class(classSeed);
        address from = _pick(fromSeed);
        uint128 locked = vesting.locked(address(captable), c, from);
        if (locked == 0) return;
        amount = bound(amount, 1, locked);
        vm.prank(address(vesting));
        captable.burnUnvested(c, from, uint128(amount));
        vesting.setLocked(address(captable), c, from, locked - uint128(amount));
        ghostBalance[c][from] -= amount;
    }

    /// @dev Vesting's lock moves as grants vest; it never exceeds the balance (V2).
    function setLock(uint256 classSeed, uint256 accountSeed, uint256 amount) external synced("setLock") {
        uint8 c = _class(classSeed);
        address account = _pick(accountSeed);
        amount = bound(amount, 0, ghostBalance[c][account]);
        vesting.setLocked(address(captable), c, account, uint128(amount));
    }

    function propose(uint256 delay) external synced("propose") {
        governor.setPendingUntil(uint48(vm.getBlockTimestamp() + bound(delay, 0, 3 days)));
    }

    function warp(uint256 dt) external synced("warp") {
        _warpTo(vm.getBlockTimestamp() + bound(dt, 1, 30 days));
    }

    // ------------------------------------------------------------------------------------------------
    // Shareholders
    // ------------------------------------------------------------------------------------------------

    function transfer(uint256 classSeed, uint256 fromSeed, uint256 toSeed, uint256 amount) external synced("transfer") {
        uint8 c = _class(classSeed);
        ICaptable.Class memory cl = captable.getClass(c);
        address from = _pick(fromSeed);
        address to = _pick(toSeed);
        uint256 unlocked = _unlocked(c, from);
        if (unlocked == 0 || !_ruleAllows(c, cl.rule, to)) return;
        amount = bound(amount, 1, unlocked);
        vm.prank(from);
        MockShareClass(address(cl.token)).transfer(to, amount);
        ghostBalance[c][from] -= amount;
        ghostBalance[c][to] += amount;
    }

    function convert(uint256 classSeed, uint256 fromSeed, uint256 amount) external synced("convert") {
        uint8 c = _class(classSeed);
        ICaptable.Class memory cl = captable.getClass(c);
        if (cl.convertsInto == NONE) return;
        address from = _pick(fromSeed);
        uint256 unlocked = _unlocked(c, from);
        if (unlocked == 0) return;
        amount = bound(amount, 1, unlocked);
        uint256 minted = cl.originalIssuePrice == 0
            ? amount
            : amount * cl.originalIssuePrice / captable.conversionPriceAt(c, vm.getBlockTimestamp());
        vm.prank(from);
        captable.convert(c, uint128(amount));
        ghostBalance[c][from] -= amount;
        ghostBalance[cl.convertsInto][from] += minted;
        ghostAuthorised[c] -= amount;
    }

    /// @dev D3 with consent: the shareholder consents from their own wallet, then the Safe or Exits moves it.
    function consentAndForce(
        uint256 classSeed,
        uint256 fromSeed,
        uint256 toSeed,
        uint256 amount,
        bool byExits
    )
        external
        synced("consentAndForce")
    {
        uint8 c = _class(classSeed);
        address from = _pick(fromSeed);
        address to = toSeed % 4 == 0 ? safe : _pick(toSeed);
        uint256 unlocked = _unlocked(c, from);
        if (unlocked == 0) return;
        amount = bound(amount, 1, unlocked);
        bytes32 reason = keccak256(abi.encode("consent", calls["consentAndForce"]));
        vm.prank(from);
        captable.consentToTransfer(c, to, uint128(amount), reason);
        vm.prank(byExits ? exits : safe);
        captable.forcedTransfer(c, from, to, uint128(amount), reason);
        ghostBalance[c][from] -= amount;
        ghostBalance[c][to] += amount;
    }

    /// @dev D3 by vote: the company Governor moves unlocked shares, including the Safe's treasury shares.
    function governorForce(
        uint256 classSeed,
        uint256 fromSeed,
        uint256 toSeed,
        uint256 amount
    )
        external
        synced("governorForce")
    {
        uint8 c = _class(classSeed);
        address[] memory all = holders();
        address from = all[bound(fromSeed, 0, all.length - 1)];
        address to = all[bound(toSeed, 0, all.length - 1)];
        uint256 unlocked = _unlocked(c, from);
        if (unlocked == 0) return;
        amount = bound(amount, 1, unlocked);
        vm.prank(address(governor));
        captable.forcedTransfer(c, from, to, uint128(amount), keccak256("vote"));
        ghostBalance[c][from] -= amount;
        ghostBalance[c][to] += amount;
    }

    // ------------------------------------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------------------------------------

    function _class(uint256 seed) internal view returns (uint8) {
        return uint8(bound(seed, 0, captable.numberOfClasses() - 1));
    }

    function _pick(uint256 seed) internal view returns (address) {
        return _shareholders[bound(seed, 0, _shareholders.length - 1)];
    }

    /// @dev What a class reserves in its conversion target: ceil(authorised * oip / floor), or its authorised
    /// one for one when it has no issue price.
    function _reserveOf(ICaptable.Class memory cl) internal pure returns (uint256) {
        if (cl.originalIssuePrice == 0) return cl.authorised;
        return Math.mulDiv(cl.authorised, cl.originalIssuePrice, cl.conversionFloorPrice, Math.Rounding.Ceil);
    }

    function _room(uint8 c, ICaptable.Class memory cl) internal view returns (uint256) {
        uint256 used = cl.token.totalSupply() + captable.convertibleReserved(c);
        return cl.authorised > used ? cl.authorised - used : 0;
    }

    function _unlocked(uint8 c, address account) internal view returns (uint256) {
        uint256 balance = ghostBalance[c][account];
        uint256 locked = vesting.locked(address(captable), c, account);
        return balance > locked ? balance - locked : 0;
    }

    function _ruleAllows(uint8 c, ICaptable.TransferRule rule, address to) internal view returns (bool) {
        if (rule == ICaptable.TransferRule.AllowAll) return true;
        if (rule == ICaptable.TransferRule.ToClassShareholders) return ghostBalance[c][to] > 0;
        if (rule == ICaptable.TransferRule.ToAnyShareholder) {
            for (uint8 k; k < captable.numberOfClasses(); ++k) {
                if (ghostBalance[k][to] > 0) return true;
            }
        }
        return false;
    }

    /// @dev Moves the clock and records every shareholder's votes and the supply at the moment just left, so
    /// the suite can check that past votes never change (E3 at every timepoint, Firm C-12).
    function _warpTo(uint256 t) internal {
        uint48 left = uint48(vm.getBlockTimestamp());
        vm.warp(t);
        if (_records.length >= MAX_RECORDS) return;
        for (uint256 i; i < _shareholders.length; ++i) {
            _records.push(Record(_shareholders[i], left, captable.getPastVotes(_shareholders[i], left)));
        }
        _supplyRecords.push(Record(address(0), left, captable.getPastTotalSupply(left)));
    }
}
