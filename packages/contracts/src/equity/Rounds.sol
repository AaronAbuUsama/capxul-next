// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { ICaptable } from "../interfaces/ICaptable.sol";
import { IPayments } from "../interfaces/IPayments.sol";
import { IRounds } from "../interfaces/IRounds.sol";

/// @title Rounds
/// @notice A company's own fundraising (spec/rounds.md): YC post-money SAFE rounds and priced rounds with NVCA
/// broad-based weighted-average anti-dilution. One EIP-1167 clone per company; the implementation is sealed (I3).
/// Money leaves only through Payments (kinds 5 and 6) to the Safe, so Rounds holds nothing after any call.
/// @dev A priced `pay` moves exactly `shares * price` and issues exactly `shares` in the same call (R1, R2). After a
/// round closes or is cancelled nothing more is issued in it (R3). Conversion rounds down (R4); anti-dilution only
/// lowers a conversion price and never below the class floor (E4).
// forge-lint: disable-start(unsafe-typecast)
// forge-lint: disable-start(block-timestamp)
// forge-lint: disable-start(reentrancy-events)
// forge-lint: disable-start(calls-loop, require-revert-in-loop, unused-return, uninitialized-local) -- the loops walk the few classes (at most MAX_CLASSES) of one trusted Captable; a bad entry aborts the whole call
contract Rounds is IRounds {
    using SafeERC20 for IERC20;

    uint16 internal constant KIND_SHARE_PURCHASE = 5;
    uint16 internal constant KIND_SAFE_PURCHASE = 6;

    address public safe;
    address public captable;
    address public payments;
    bool private _initialized;

    uint256 private _lastSafeRound;
    uint256 private _lastNote;
    uint256 private _lastPricedRound;
    mapping(uint256 roundId => SafeRound) private _safeRounds;
    mapping(uint256 roundId => mapping(address investor => SafeInvitation)) private _safeInvitations;
    mapping(uint256 noteId => SafeNote) private _notes;
    mapping(uint256 roundId => PricedRound) private _pricedRounds;
    mapping(uint256 roundId => mapping(address investor => Position)) private _positions;
    mapping(uint256 roundId => mapping(uint8 classId => bool)) private _consented;
    /// @dev Set once SAFE notes were converted into a priced round; such a round can no longer be cancelled.
    mapping(uint256 roundId => bool) private _hasConversions;

    /// @dev The implementation is sealed (I3); clones start unset.
    constructor() {
        _initialized = true;
    }

    /// @inheritdoc IRounds
    // forge-lint: disable-next-line(missing-zero-check) -- the Installer wires real addresses once
    function initialize(address safe_, address captable_, address payments_) external {
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;
        safe = safe_;
        captable = captable_;
        payments = payments_;
    }

    // ---------------------------------------------------------------- SAFE rounds

    /// @inheritdoc IRounds
    function createSafeRound(
        address token,
        uint128 valuationCap,
        uint16 discountBps,
        uint64 closesAt,
        bytes32 documentHash
    )
        external
        returns (uint256 roundId)
    {
        _onlyBoard();
        if (valuationCap == 0) revert InvalidRound("zero cap");
        if (discountBps >= 10_000) revert InvalidRound("discount of 100% or more");
        if (closesAt < block.timestamp) revert InvalidRound("close date passed");
        _checkToken(token);
        roundId = ++_lastSafeRound;
        _safeRounds[roundId] = SafeRound({
            token: token,
            valuationCap: valuationCap,
            discountBps: discountBps,
            closesAt: closesAt,
            documentHash: documentHash,
            closed: false
        });
        emit SafeRoundCreated(roundId, token, valuationCap, discountBps, closesAt, documentHash);
    }

    /// @inheritdoc IRounds
    function inviteSafe(uint256 roundId, address investor, uint128 maxAmount) external {
        _onlyBoard();
        _openSafeRound(roundId);
        _safeInvitations[roundId][investor].maxAmount = maxAmount;
        emit SafeInvited(roundId, investor, maxAmount);
    }

    /// @inheritdoc IRounds
    function signSafe(uint256 roundId, uint128 amount, bytes32 documentHash) external returns (uint256 noteId) {
        SafeInvitation memory inv = _safeInvitations[roundId][msg.sender];
        if (inv.maxAmount == 0) revert NotInvited();
        SafeRound memory r = _openSafeRound(roundId);
        if (uint256(inv.signed) + amount > inv.maxAmount) {
            // The Board may have lowered the invitation below what is already signed: nothing is left open.
            revert OverInvited(inv.maxAmount > inv.signed ? inv.maxAmount - inv.signed : 0, amount);
        }

        _safeInvitations[roundId][msg.sender].signed = inv.signed + amount;
        noteId = ++_lastNote;
        _notes[noteId] = SafeNote({
            roundId: roundId, investor: msg.sender, amount: amount, documentHash: documentHash, converted: false
        });
        bytes32 paymentId = _payToSafe(r.token, amount, KIND_SAFE_PURCHASE, documentHash, keccak256(abi.encode(noteId)));
        emit SafeSigned(roundId, noteId, msg.sender, amount, documentHash, paymentId);
    }

    /// @inheritdoc IRounds
    function closeSafeRound(uint256 roundId) external {
        _onlyBoard();
        SafeRound storage r = _safeRounds[roundId];
        if (r.token == address(0)) revert InvalidRound("unknown SAFE round");
        if (r.closed) revert RoundIsClosed();
        r.closed = true;
        emit SafeRoundClosed(roundId);
    }

    /// @inheritdoc IRounds
    function convertSafes(uint256[] calldata noteIds, uint256 pricedRoundId, uint256 companyCapitalization) external {
        _onlyBoard();
        PricedRound memory p = _openPricedRound(pricedRoundId);
        // R3: nothing is issued in a round after its pay-by date, by any path (plan call 9).
        if (block.timestamp > p.payBy) revert PayByPassed(p.payBy);
        if (companyCapitalization == 0) revert InvalidRound("zero capitalization");

        if (noteIds.length != 0) _hasConversions[pricedRoundId] = true;
        uint128[] memory shares = new uint128[](noteIds.length);
        for (uint256 i; i < noteIds.length; ++i) {
            SafeNote storage n = _notes[noteIds[i]];
            if (n.investor == address(0)) revert InvalidRound("unknown note");
            if (n.converted) revert InvalidRound("note already converted");
            n.converted = true;
            SafeRound storage r = _safeRounds[n.roundId];
            uint256 price = _conversionPrice(r.valuationCap, companyCapitalization, p.price, r.discountBps);
            if (price == 0) revert InvalidRound("zero conversion price");
            shares[i] = uint128(_conversionShares(n.amount, price));
            // The dust stays with the company; a note that rounds to no shares is converted and issues nothing.
            if (shares[i] != 0) ICaptable(captable).issue(p.classId, n.investor, shares[i], n.documentHash);
        }
        emit SafesConverted(pricedRoundId, noteIds, shares);
    }

    // -------------------------------------------------------------- priced rounds

    /// @inheritdoc IRounds
    function createPricedRound(
        uint8 classId,
        address token,
        uint128 price,
        uint128 maxShares,
        uint64 payBy,
        bytes32 documentHash
    )
        external
        returns (uint256 roundId)
    {
        _onlyBoard();
        if (price == 0) revert InvalidRound("zero price");
        if (maxShares == 0) revert InvalidRound("zero maximum");
        if (payBy < block.timestamp) revert InvalidRound("pay-by date passed");
        _checkToken(token);
        ICaptable(captable).getClass(classId); // UnknownClass bubbles
        roundId = ++_lastPricedRound;
        PricedRound storage r = _pricedRounds[roundId];
        r.classId = classId;
        r.token = token;
        r.price = price;
        r.maxShares = maxShares;
        r.payBy = payBy;
        r.documentHash = documentHash;
        emit PricedRoundCreated(roundId, classId, token, price, maxShares, payBy, documentHash);
    }

    /// @inheritdoc IRounds
    function invite(uint256 roundId, address investor, uint128 maxAmount) external {
        _onlyBoard();
        _openPricedRound(roundId);
        _positions[roundId][investor].maxAmount = maxAmount;
        emit Invited(roundId, investor, maxAmount);
    }

    /// @inheritdoc IRounds
    function commit(uint256 roundId, uint128 amount, bytes32 documentHash) external {
        _openPricedRound(roundId);
        Position storage pos = _positions[roundId][msg.sender];
        if (pos.maxAmount == 0) revert NotInvited();
        if (amount > pos.maxAmount) revert OverInvited(pos.maxAmount, amount);
        pos.committed = amount;
        emit Committed(roundId, msg.sender, amount, documentHash);
    }

    /// @inheritdoc IRounds
    function allocate(uint256 roundId, address investor, uint128 shares) external {
        _onlyBoard();
        PricedRound storage r = _pricedRounds[roundId];
        _openPricedRound(roundId);
        Position storage pos = _positions[roundId][investor];
        if (pos.maxAmount == 0 || pos.committed == 0) revert NotInvited();
        if (pos.paid) revert AlreadyPaid();
        uint128 left = r.maxShares - r.allocatedShares;
        if (shares > left) revert OverAllocated(left, shares);
        r.allocatedShares += shares;
        pos.shares += shares;
        emit Allocated(roundId, investor, shares);
    }

    /// @inheritdoc IRounds
    function pay(uint256 roundId) external returns (bytes32 paymentId) {
        Position storage pos = _positions[roundId][msg.sender];
        uint128 shares = pos.shares;
        if (shares == 0) revert NotAllocated();
        if (pos.paid) revert AlreadyPaid();
        // Closed or cancelled before the date: a closed round is only ever past `payBy` with an unpaid allocation.
        PricedRound memory r = _openPricedRound(roundId);
        if (block.timestamp > r.payBy) revert PayByPassed(r.payBy);

        pos.paid = true;
        _pricedRounds[roundId].issuedShares = r.issuedShares + shares;
        uint256 amount = _payAmount(shares, r.price);
        paymentId = _payToSafe(
            r.token, amount, KIND_SHARE_PURCHASE, r.documentHash, keccak256(abi.encode(roundId, msg.sender))
        );
        ICaptable(captable).issue(r.classId, msg.sender, shares, r.documentHash);
        emit Paid(roundId, msg.sender, shares, amount, paymentId);
    }

    /// @inheritdoc IRounds
    function consent(uint256 roundId) external {
        PricedRound memory r = _openPricedRound(roundId);
        uint8 governed = type(uint8).max; // the first class the caller governs, for the error
        bool any;
        for (uint8 k; k < r.classId; ++k) {
            ICaptable.Class memory c = ICaptable(captable).getClass(k);
            if (c.classGovernor != msg.sender) continue;
            if (governed == type(uint8).max) governed = k;
            if (c.originalIssuePrice == 0 || ICaptable(captable).conversionPriceAt(k, block.timestamp) <= r.price) {
                continue;
            }
            any = true;
            _consented[roundId][k] = true;
            emit ConsentGiven(roundId, k);
        }
        if (!any) revert NotAffected(governed);
    }

    /// @inheritdoc IRounds
    function close(uint256 roundId, uint256 deemedOutstandingA) external {
        _onlyBoard();
        PricedRound memory r = _openPricedRound(roundId);
        if (block.timestamp <= r.payBy && r.issuedShares != r.allocatedShares) {
            revert InvalidRound("allocations still payable");
        }
        _pricedRounds[roundId].closed = true;

        Adjustment[] memory adjustments = new Adjustment[](r.classId);
        uint256 count;
        for (uint8 k; k < r.classId; ++k) {
            ICaptable.Class memory c = ICaptable(captable).getClass(k);
            if (c.originalIssuePrice == 0) continue;
            uint128 cp1 = ICaptable(captable).conversionPriceAt(k, block.timestamp);
            if (cp1 <= r.price) continue;
            if (c.classGovernor != address(0) && !_consented[roundId][k]) revert ConsentMissing(k);
            uint128 cp2 = _antiDilutedPrice(cp1, r.price, deemedOutstandingA, r.issuedShares);
            if (cp2 < c.conversionFloorPrice) cp2 = c.conversionFloorPrice;
            if (cp2 >= cp1) continue;
            ICaptable(captable).setConversionPrice(k, cp2);
            adjustments[count++] = Adjustment({ classId: k, oldPrice: cp1, newPrice: cp2 });
        }
        assembly ("memory-safe") {
            mstore(adjustments, count)
        }
        emit RoundClosed(roundId, adjustments);
    }

    /// @inheritdoc IRounds
    function cancel(uint256 roundId) external {
        _onlyBoard();
        PricedRound storage r = _pricedRounds[roundId];
        _openPricedRound(roundId);
        // Plan call 18: refused once anything was issued in the round, by a payment or a SAFE conversion.
        if (r.issuedShares != 0 || _hasConversions[roundId]) revert PaymentsStarted();
        r.cancelled = true;
        emit RoundCancelled(roundId);
    }

    // ---------------------------------------------------------------------- views

    /// @inheritdoc IRounds
    function safeRound(uint256 roundId) external view returns (SafeRound memory) {
        return _safeRounds[roundId];
    }

    /// @inheritdoc IRounds
    function safeInvitation(uint256 roundId, address investor) external view returns (SafeInvitation memory) {
        return _safeInvitations[roundId][investor];
    }

    /// @inheritdoc IRounds
    function safeNote(uint256 noteId) external view returns (SafeNote memory) {
        return _notes[noteId];
    }

    /// @inheritdoc IRounds
    function pricedRound(uint256 roundId) external view returns (PricedRound memory) {
        return _pricedRounds[roundId];
    }

    /// @inheritdoc IRounds
    function position(uint256 roundId, address investor) external view returns (Position memory) {
        return _positions[roundId][investor];
    }

    /// @inheritdoc IRounds
    function consented(uint256 roundId, uint8 classId) external view returns (bool) {
        return _consented[roundId][classId];
    }

    // ------------------------------------------------------------------- internals

    function _onlyBoard() internal view {
        if (msg.sender != safe) revert OnlyBoard();
    }

    /// @dev A token whose decimals are not the price unit's cannot be compared with a conversion price.
    function _checkToken(address token) internal view {
        // `try` cannot catch a call to an address without code, so refuse it first.
        if (token.code.length == 0) revert InvalidRound("token decimals");
        uint8 expected = ICaptable(captable).PRICE_DECIMALS();
        try IERC20Metadata(token).decimals() returns (uint8 d) {
            if (d != expected) revert InvalidRound("token decimals");
        } catch {
            revert InvalidRound("token decimals");
        }
    }

    /// @dev A SAFE round that exists and still takes notes: not closed, not past `closesAt`.
    function _openSafeRound(uint256 roundId) internal view returns (SafeRound memory r) {
        r = _safeRounds[roundId];
        if (r.token == address(0)) revert InvalidRound("unknown SAFE round");
        if (r.closed || block.timestamp > r.closesAt) revert RoundIsClosed();
    }

    /// @dev A priced round that exists and is neither closed nor cancelled.
    function _openPricedRound(uint256 roundId) internal view returns (PricedRound memory r) {
        r = _pricedRounds[roundId];
        if (r.token == address(0)) revert InvalidRound("unknown round");
        if (r.closed) revert RoundIsClosed();
        if (r.cancelled) revert RoundIsCancelled();
    }

    /// @dev Pulls `amount` from the caller and pays it to the Safe through Payments, the one way money leaves.
    function _payToSafe(
        address token,
        uint256 amount,
        uint16 kind,
        bytes32 documentHash,
        bytes32 jobNonce
    )
        internal
        returns (bytes32 paymentId)
    {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        IERC20(token).forceApprove(payments, amount);
        IPayments.PaymentItem memory item = IPayments.PaymentItem({
            paymentId: bytes32(0),
            recipient: safe,
            token: token,
            amount: amount,
            kind: kind,
            documentHash: documentHash,
            jobNonce: jobNonce,
            executor: address(this)
        });
        paymentId = IPayments(payments).paymentId(item);
        item.paymentId = paymentId;
        IPayments(payments).send(item);
    }

    /// @dev R1 (ruling D14): what a priced `pay` moves, exactly `shares * price`, never rounded. Multiply in
    /// `unchecked`: two `uint128` cannot overflow `uint256`, and Halmos (gate 10) cannot decide the checked form.
    function _payAmount(uint128 shares, uint128 price) internal pure returns (uint256) {
        unchecked {
            return uint256(shares) * uint256(price);
        }
    }

    /// @dev R4: the SAFE conversion price, `min(valuationCap / companyCapitalization,
    /// price * (10,000 - discountBps) / 10,000)`, each rounded down to the price unit.
    function _conversionPrice(
        uint128 valuationCap,
        uint256 companyCapitalization,
        uint128 price,
        uint16 discountBps
    )
        internal
        pure
        returns (uint256)
    {
        uint256 capPrice = uint256(valuationCap) / companyCapitalization;
        uint256 discounted = uint256(price) * (10_000 - discountBps) / 10_000;
        return capPrice < discounted ? capPrice : discounted;
    }

    /// @dev R4: a note's shares, `amount / conversionPrice` rounded down; the dust stays with the company.
    function _conversionShares(uint128 amount, uint256 conversionPrice) internal pure returns (uint256) {
        return uint256(amount) / conversionPrice;
    }

    /// @dev E4: NVCA broad-based weighted average, `CP2 = CP1 * (A + B) / (A + C)` with
    /// `B = C * price / CP1` (the money raised over CP1) rounded down, `CP2` rounded down; `CP1` unchanged when
    /// `price >= CP1` or `C == 0`. Otherwise B < C, so CP2 <= CP1 and its uint128 cast is safe (J55). Arguments: CP1, the
    /// round price, A, C. The floor is applied by the caller; `close` adjusts only when the floored price is below CP1.
    function _antiDilutedPrice(uint128 cp1, uint128 price, uint256 a, uint256 c) internal pure returns (uint128) {
        if (price >= cp1 || c == 0) return cp1;
        uint256 b = c * price / cp1;
        uint256 cp2 = uint256(cp1) * (a + b) / (a + c);
        return uint128(cp2);
    }
}
// forge-lint: disable-end(calls-loop, require-revert-in-loop, unused-return, uninitialized-local)
// forge-lint: disable-end(reentrancy-events)
// forge-lint: disable-end(block-timestamp)
// forge-lint: disable-end(unsafe-typecast)
