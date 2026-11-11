// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";

import { IRounds } from "../../../src/interfaces/IRounds.sol";
import { MockERC20 } from "../../mocks/MockERC20.sol";
import { MockCaptableForRounds } from "../../utils/Rounds/MockCaptableForRounds.sol";

/// @notice The honest actors of Rounds.invariant.t.sol (invariants.md "Handlers": createPricedRound, invite,
/// commit, allocate, pay, consent, close, cancel; createSafeRound, inviteSafe, signSafe, closeSafeRound,
/// convertSafes; warp). The Board (the company Safe) runs every round; three investors (the Series C investor,
/// the angel and the pre-seed fund) sign SAFEs, commit and pay; Series Seed's class Governor consents to down
/// rounds. Priced rounds sell Series C (class 3); Series Seed (1, with a class Governor) and Series A (2, without)
/// are the earlier classes a down round adjusts. Every input is bounded so each call must succeed
/// (`fail_on_revert`). The handler keeps its own figures, written from spec/rounds.md and never read back from
/// Rounds: shares paid per round, money to the Safe, shares from conversions, and the issued count each round
/// had when it ended.
contract RoundsHandler is Test {
    uint8 internal constant SEED = 1;
    uint8 internal constant SERIES_A = 2;
    uint8 internal constant SERIES_C = 3;
    bytes32 internal constant DOC = keccak256("round document");

    IRounds internal immutable rounds;
    MockCaptableForRounds internal immutable captable;
    MockERC20 internal immutable usdc;
    address internal immutable safe;
    address internal immutable seedGovernor;
    address[] internal investors;

    uint256[] public safeIds;
    uint256[] public pricedIds;
    uint256[] public noteIds;

    mapping(uint256 roundId => uint256) public ghostPaidShares;
    mapping(uint256 roundId => bool) public ghostEnded;
    mapping(uint256 roundId => uint256) public ghostIssuedAtEnd;
    /// @dev Rounds that SAFE notes were converted into; they cannot be cancelled (plan call 18).
    mapping(uint256 roundId => bool) public ghostHasConversions;
    uint256 public ghostPaidSharesTotal;
    uint256 public ghostConvertedShares;
    uint256 public ghostMoneyToSafe;
    uint256 public ghostConvertedNotes;
    /// @dev Set when a conversion issued other than `floor(amount / conversionPrice)` (R4).
    bool public ghostR4Broken;
    /// @dev Set when a pay moved other than exactly `shares * price` (R1).
    bool public ghostR1Broken;
    /// @dev Set when a close raised a conversion price or took it below its floor (E4).
    bool public ghostE4Broken;
    mapping(bytes32 fn => uint256) public calls;

    constructor(
        IRounds rounds_,
        MockCaptableForRounds captable_,
        MockERC20 usdc_,
        address safe_,
        address seedGovernor_,
        address[] memory investors_
    ) {
        rounds = rounds_;
        captable = captable_;
        usdc = usdc_;
        safe = safe_;
        seedGovernor = seedGovernor_;
        investors = investors_;
    }

    function safeIdsLength() external view returns (uint256) {
        return safeIds.length;
    }

    function pricedIdsLength() external view returns (uint256) {
        return pricedIds.length;
    }

    function noteIdsLength() external view returns (uint256) {
        return noteIds.length;
    }

    function _investor(uint256 seed) internal view returns (address) {
        return investors[seed % investors.length];
    }

    // ---------------------------------------------------------------------------------------------------
    // SAFE rounds
    // ---------------------------------------------------------------------------------------------------

    function createSafeRound(uint128 cap, uint16 discountBps) external {
        cap = uint128(bound(cap, 1e12, 1e14)); // a $1M to $100M post-money cap
        discountBps = uint16(bound(discountBps, 0, 5000));
        vm.prank(safe);
        safeIds.push(rounds.createSafeRound(address(usdc), cap, discountBps, uint64(block.timestamp + 30 days), DOC));
        calls["createSafeRound"]++;
    }

    /// @dev The first SAFE round from a seeded index that is open and before its close date.
    function _openSafeRound(uint256 seed) internal view returns (bool, uint256) {
        uint256 n = safeIds.length;
        for (uint256 i; i < n; ++i) {
            uint256 id = safeIds[(seed % n + i) % n];
            IRounds.SafeRound memory r = rounds.safeRound(id);
            if (!r.closed && block.timestamp <= r.closesAt) return (true, id);
        }
        return (false, 0);
    }

    function inviteSafe(uint256 seed, uint256 who, uint128 maxAmount) external {
        (bool open, uint256 id) = _openSafeRound(seed);
        if (!open) return;
        address investor = _investor(who);
        uint128 signed = rounds.safeInvitation(id, investor).signed;
        maxAmount = uint128(bound(maxAmount, signed == 0 ? 1e6 : signed, uint256(signed) + 1e12));
        vm.prank(safe);
        rounds.inviteSafe(id, investor, maxAmount);
        calls["inviteSafe"]++;
    }

    function signSafe(uint256 seed, uint256 who, uint128 amount) external {
        (bool open, uint256 id) = _openSafeRound(seed);
        if (!open) return;
        address investor = _investor(who);
        IRounds.SafeInvitation memory inv = rounds.safeInvitation(id, investor);
        if (inv.maxAmount <= inv.signed) {
            vm.prank(safe);
            rounds.inviteSafe(id, investor, inv.signed + 1e11); // $100,000 more
            inv.maxAmount = inv.signed + 1e11;
        }
        amount = uint128(bound(amount, 1, inv.maxAmount - inv.signed));
        usdc.mint(investor, amount);
        vm.prank(investor);
        noteIds.push(rounds.signSafe(id, amount, keccak256(abi.encode("signed SAFE", investor, amount))));
        ghostMoneyToSafe += amount;
        calls["signSafe"]++;
    }

    function closeSafeRound(uint256 seed) external {
        if (safeIds.length == 0) return;
        uint256 id = safeIds[bound(seed, 0, safeIds.length - 1)];
        if (rounds.safeRound(id).closed) return;
        vm.prank(safe);
        rounds.closeSafeRound(id);
        calls["closeSafeRound"]++;
    }

    /// @dev Converts up to two open notes into an open priced round. R4 is checked note by note against the
    /// handler's own formula.
    function convertSafes(uint256 noteSeed, uint256 roundSeed, uint256 capitalization) external {
        (bool open, uint256 pricedId) = _payableRound(roundSeed);
        if (!open || noteIds.length == 0) return;
        uint256[] memory ids = _openNotes(noteSeed);
        if (ids.length == 0) return;
        capitalization = bound(capitalization, 1e6, 1e7);
        (address[] memory who, uint256[] memory expected, uint256[] memory before) =
            _expectations(ids, rounds.pricedRound(pricedId).price, capitalization);
        uint256 safeMoney = usdc.balanceOf(safe);

        vm.prank(safe);
        rounds.convertSafes(ids, pricedId, capitalization);

        _checkR4(ids, who, expected, before);
        ghostHasConversions[pricedId] = true;
        if (usdc.balanceOf(safe) != safeMoney) ghostR4Broken = true; // conversion moves no money
        ghostConvertedNotes += ids.length;
        calls["convertSafes"]++;
    }

    /// @dev Up to two unconverted notes, starting at a seeded index.
    function _openNotes(uint256 noteSeed) internal view returns (uint256[] memory ids) {
        uint256 first = bound(noteSeed, 0, noteIds.length - 1);
        uint256[2] memory pick;
        uint256 n;
        for (uint256 i; i < noteIds.length && n < 2; ++i) {
            uint256 noteId = noteIds[(first + i) % noteIds.length];
            if (!rounds.safeNote(noteId).converted) pick[n++] = noteId;
        }
        ids = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            ids[i] = pick[i];
        }
    }

    /// @dev Each note's investor, its `floor(amount / conversionPrice)` and the investor's balance now.
    function _expectations(
        uint256[] memory ids,
        uint128 price,
        uint256 capitalization
    )
        internal
        view
        returns (address[] memory who, uint256[] memory expected, uint256[] memory before)
    {
        who = new address[](ids.length);
        expected = new uint256[](ids.length);
        before = new uint256[](ids.length);
        for (uint256 i; i < ids.length; ++i) {
            IRounds.SafeNote memory note = rounds.safeNote(ids[i]);
            IRounds.SafeRound memory r = rounds.safeRound(note.roundId);
            uint256 capPrice = uint256(r.valuationCap) / capitalization;
            uint256 discounted = uint256(price) * (10_000 - r.discountBps) / 10_000;
            expected[i] = note.amount / (capPrice < discounted ? capPrice : discounted);
            who[i] = note.investor;
            before[i] = captable.token(SERIES_C).balanceOf(note.investor);
        }
    }

    /// @dev Per investor: the shares received equal the sum of their notes' floors (two notes may share one).
    function _checkR4(
        uint256[] memory ids,
        address[] memory who,
        uint256[] memory expected,
        uint256[] memory before
    )
        internal
    {
        for (uint256 i; i < ids.length; ++i) {
            uint256 want;
            for (uint256 j; j < ids.length; ++j) {
                if (who[j] == who[i]) want += expected[j];
            }
            if (captable.token(SERIES_C).balanceOf(who[i]) - before[i] != want) ghostR4Broken = true;
            if (!rounds.safeNote(ids[i]).converted) ghostR4Broken = true;
            ghostConvertedShares += expected[i];
        }
    }

    // ---------------------------------------------------------------------------------------------------
    // Priced rounds
    // ---------------------------------------------------------------------------------------------------

    function createPricedRound(uint128 price, uint128 maxShares) external {
        price = uint128(bound(price, 1e5, 5e6)); // $0.10 to $5.00
        maxShares = uint128(bound(maxShares, 1, 1e6));
        vm.prank(safe);
        pricedIds.push(
            rounds.createPricedRound(SERIES_C, address(usdc), price, maxShares, uint64(block.timestamp + 30 days), DOC)
        );
        calls["createPricedRound"]++;
    }

    /// @dev The first priced round from a seeded index that is neither closed nor cancelled.
    function _liveRound(uint256 seed) internal view returns (bool, uint256) {
        return _findRound(seed, false);
    }

    /// @dev As `_liveRound`, and not past its pay-by date.
    function _payableRound(uint256 seed) internal view returns (bool, uint256) {
        return _findRound(seed, true);
    }

    function _findRound(uint256 seed, bool inTime) internal view returns (bool, uint256) {
        uint256 n = pricedIds.length;
        for (uint256 i; i < n; ++i) {
            uint256 id = pricedIds[(seed % n + i) % n];
            IRounds.PricedRound memory r = rounds.pricedRound(id);
            if (r.closed || r.cancelled) continue;
            if (inTime && block.timestamp > r.payBy) continue;
            return (true, id);
        }
        return (false, 0);
    }

    function invite(uint256 seed, uint256 who, uint128 maxAmount) external {
        (bool live, uint256 id) = _liveRound(seed);
        if (!live) return;
        address investor = _investor(who);
        IRounds.Position memory p = rounds.position(id, investor);
        maxAmount = uint128(bound(maxAmount, p.committed == 0 ? 1 : p.committed, 1e13));
        vm.prank(safe);
        rounds.invite(id, investor, maxAmount);
        calls["invite"]++;
    }

    function commit(uint256 seed, uint256 who, uint128 amount) external {
        (bool live, uint256 id) = _liveRound(seed);
        if (!live) return;
        address investor = _investor(who);
        IRounds.Position memory p = rounds.position(id, investor);
        if (p.maxAmount == 0) {
            // The Board's invitation comes first in a real round.
            vm.prank(safe);
            rounds.invite(id, investor, 1e13);
            p.maxAmount = 1e13;
        }
        amount = uint128(bound(amount, 1, p.maxAmount));
        vm.prank(investor);
        rounds.commit(id, amount, DOC);
        calls["commit"]++;
    }

    function allocate(uint256 seed, uint256 who, uint128 shares) external {
        (bool open, uint256 id) = _payableRound(seed);
        if (!open) return;
        if (_allocateTo(id, _investor(who), shares)) calls["allocate"]++;
    }

    /// @dev Invites and commits first when needed, then allocates; false when the investor paid or the round is full.
    function _allocateTo(uint256 id, address investor, uint128 shares) internal returns (bool) {
        IRounds.Position memory p = rounds.position(id, investor);
        IRounds.PricedRound memory r = rounds.pricedRound(id);
        if (p.paid || r.allocatedShares >= r.maxShares) return false;
        if (p.committed == 0) {
            if (p.maxAmount == 0) {
                vm.prank(safe);
                rounds.invite(id, investor, 1e13);
                p.maxAmount = 1e13;
            }
            vm.prank(investor);
            rounds.commit(id, p.maxAmount, DOC);
        }
        shares = uint128(bound(shares, 1, r.maxShares - r.allocatedShares));
        vm.prank(safe);
        rounds.allocate(id, investor, shares);
        return true;
    }

    /// @dev Pays an allocated, unpaid investor. When none is waiting, the call first runs the Board's batch
    /// (a payable round, then invite, commit and allocate), so that R1 and R2 are exercised on most runs.
    function pay(uint256 seed, uint256 who) external {
        (bool open, uint256 id, address investor) = _unpaid(seed, who);
        if (!open) {
            (open, id) = _payableRound(seed);
            if (!open) {
                vm.prank(safe);
                id = rounds.createPricedRound(
                    SERIES_C, address(usdc), uint128(bound(seed, 1e5, 5e6)), 1e6, uint64(block.timestamp + 30 days), DOC
                );
                pricedIds.push(id);
            }
            investor = _investor(who);
            if (!_allocateTo(id, investor, uint128(seed >> 128))) return;
        }
        IRounds.Position memory p = rounds.position(id, investor);
        uint256 amount = uint256(p.shares) * rounds.pricedRound(id).price;
        usdc.mint(investor, amount);
        uint256 investorBefore = usdc.balanceOf(investor);
        vm.prank(investor);
        rounds.pay(id);
        // R1 per call: exactly shares x price left the investor.
        if (investorBefore - usdc.balanceOf(investor) != amount) ghostR1Broken = true;
        ghostPaidShares[id] += p.shares;
        ghostPaidSharesTotal += p.shares;
        ghostMoneyToSafe += amount;
        calls["pay"]++;
    }

    /// @dev The first payable round from a seeded index with an allocated, unpaid investor.
    function _unpaid(uint256 seed, uint256 who) internal view returns (bool, uint256, address) {
        uint256 n = pricedIds.length;
        for (uint256 i; i < n; ++i) {
            (bool open, uint256 id) = _payableRound(seed % n + i);
            if (!open) return (false, 0, address(0));
            for (uint256 j; j < investors.length; ++j) {
                address investor = investors[(who % investors.length + j) % investors.length];
                IRounds.Position memory p = rounds.position(id, investor);
                if (p.shares != 0 && !p.paid) return (true, id, investor);
            }
        }
        return (false, 0, address(0));
    }

    function consent(uint256 seed) external {
        (bool live, uint256 id) = _liveRound(seed);
        if (!live || rounds.consented(id, SEED)) return;
        if (captable.conversionPrice(SEED) <= rounds.pricedRound(id).price) return;
        vm.prank(seedGovernor);
        rounds.consent(id);
        calls["consent"]++;
    }

    /// @dev The Board's closing batch: Seed's class Governor consents first when Seed is affected.
    function close(uint256 seed, uint256 a) external {
        (bool live, uint256 id) = _liveRound(seed);
        if (!live) return;
        IRounds.PricedRound memory r = rounds.pricedRound(id);
        if (block.timestamp <= r.payBy && r.issuedShares != r.allocatedShares) return;
        if (captable.conversionPrice(SEED) > r.price && !rounds.consented(id, SEED)) {
            vm.prank(seedGovernor);
            rounds.consent(id);
        }
        uint128 seedBefore = captable.conversionPrice(SEED);
        uint128 aBefore = captable.conversionPrice(SERIES_A);
        vm.prank(safe);
        rounds.close(id, bound(a, 0, 1e8));
        _checkE4(SEED, seedBefore);
        _checkE4(SERIES_A, aBefore);
        _end(id);
        calls["close"]++;
    }

    function _checkE4(uint8 classId, uint128 before) internal {
        uint128 now_ = captable.conversionPrice(classId);
        if (now_ > before || now_ < captable.getClass(classId).conversionFloorPrice) ghostE4Broken = true;
    }

    function cancel(uint256 seed) external {
        (bool live, uint256 id) = _liveRound(seed);
        if (!live || rounds.pricedRound(id).issuedShares != 0 || ghostHasConversions[id]) return;
        vm.prank(safe);
        rounds.cancel(id);
        _end(id);
        calls["cancel"]++;
    }

    function _end(uint256 id) internal {
        ghostEnded[id] = true;
        ghostIssuedAtEnd[id] = rounds.pricedRound(id).issuedShares;
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 1 hours, 20 days));
        calls["warp"]++;
    }
}
