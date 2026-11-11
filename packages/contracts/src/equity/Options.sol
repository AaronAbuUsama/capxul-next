// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { ICaptable } from "../interfaces/ICaptable.sol";
import { IOptions } from "../interfaces/IOptions.sol";
import { IPayments } from "../interfaces/IPayments.sol";
import { Calendar } from "../libraries/Calendar.sol";

/// @title Options
/// @notice A company's option pool on one class (spec/options.md). The Board sets the pool and grants from it,
/// the grantee accepts the exact terms (Q18.1) and exercises what has vested: the strike goes to the Safe
/// through Payments (kind 7) and `Captable.issue` mints the shares in the same transaction. One EIP-1167 clone
/// per company; the implementation is sealed (I3). It holds no tokens after any call.
/// @dev Vesting is Vesting's calendar-month schedule (floor of `shares * months(start, t) / months(start, end)`).
/// `endAllForExit` is O(1): it records the call's time and every grant that existed then reads as cancelled and
/// ended at that time (`_view`), so a sale's settle does not depend on the number of grants.
// forge-lint: disable-start(unsafe-typecast)
// forge-lint: disable-start(block-timestamp)
// forge-lint: disable-start(reentrancy-events)
contract Options is IOptions {
    using SafeERC20 for IERC20;

    uint16 internal constant KIND_OPTION_EXERCISE = 7;

    address public safe;
    address public captable;
    address public payments;
    uint8 public classId;
    bool private _initialized;

    uint128 public pool;
    uint128 public allocated;
    /// @dev The last grant id; the last grant id the latest `endAllForExit` covered (0: none); its calls so far.
    uint64 private _lastId;
    uint64 private _exitLastId;
    uint64 private _exitCalls;
    mapping(uint256 id => OptionGrant) private grantsById;
    /// @dev The time of each `endAllForExit` call, from call 0.
    mapping(uint256 call => uint64) private _exitAt;
    /// @dev For a grant made after an `endAllForExit` call: how many calls came before it (so the next one ends it).
    mapping(uint256 id => uint64) private _exitCallOf;

    /// @dev The implementation is sealed (I3); clones start unset.
    constructor() {
        _initialized = true;
    }

    /// @inheritdoc IOptions
    // forge-lint: disable-next-line(missing-zero-check) -- the Installer wires real addresses once
    function initialize(address safe_, address captable_, address payments_, uint8 classId_) external {
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;
        safe = safe_;
        captable = captable_;
        payments = payments_;
        classId = classId_;
    }

    /// @inheritdoc IOptions
    function setPool(uint128 amount) external {
        _onlyBoard();
        if (amount < allocated) revert PoolBelowAllocated(allocated);
        pool = amount;
        emit PoolSet(amount);
    }

    /// @inheritdoc IOptions
    function grant(
        address grantee,
        uint128 shares,
        address strikeToken,
        uint128 strikePrice,
        uint64 start,
        uint64 cliff,
        uint64 end_,
        uint64 offerExpiresAt,
        uint64 expiresAt,
        uint32 exerciseWindowDays,
        bytes32 documentHash
    )
        external
        returns (uint256 id)
    {
        _onlyBoard();
        uint128 left = pool - allocated;
        if (shares > left) revert PoolExceeded(left, shares);
        if (cliff < start || end_ < cliff || expiresAt <= end_) revert InvalidSchedule();
        if (cliff != end_ && Calendar.monthsBetween(start, end_) == 0) revert InvalidSchedule();

        allocated += shares;
        id = ++_lastId;
        if (_exitCalls != 0) _exitCallOf[id] = _exitCalls;
        OptionGrant memory g = OptionGrant({
            grantee: grantee,
            shares: shares,
            exercised: 0,
            strikeToken: strikeToken,
            strikePrice: strikePrice,
            start: start,
            cliff: cliff,
            end: end_,
            offerExpiresAt: offerExpiresAt,
            expiresAt: expiresAt,
            endedAt: 0,
            exerciseWindowDays: exerciseWindowDays,
            accepted: false,
            cancelled: false,
            documentHash: documentHash
        });
        grantsById[id] = g;
        emit OptionsGranted(id, grantee, g);
    }

    /// @inheritdoc IOptions
    function accept(uint256 id, bytes32 termsHash) external {
        OptionGrant memory g = _view(id);
        if (msg.sender != g.grantee) revert OnlyGrantee();
        if (g.cancelled || block.timestamp > g.offerExpiresAt) revert OfferExpired();
        if (termsHash != g.documentHash) revert TermsMismatch();
        grantsById[id].accepted = true;
        emit OptionsAccepted(id, msg.sender);
    }

    /// @inheritdoc IOptions
    function exercise(uint256 id, uint128 shares) external {
        OptionGrant memory g = _view(id);
        if (msg.sender != g.grantee) revert OnlyGrantee();
        if (!g.accepted) revert NotAccepted();
        if (g.cancelled || block.timestamp > g.expiresAt) revert ExerciseWindowClosed();
        if (g.endedAt != 0 && block.timestamp > _windowEnd(g)) revert ExerciseWindowClosed();
        uint128 vested = _vested(g, uint64(block.timestamp));
        if (uint256(g.exercised) + shares > vested) revert NotVested(vested, g.exercised, shares);

        grantsById[id].exercised = g.exercised + shares;
        pool -= shares;
        allocated -= shares;

        uint256 cost = uint256(shares) * g.strikePrice;
        bytes32 paymentId = bytes32(0);
        if (cost != 0) {
            IERC20 token = IERC20(g.strikeToken);
            token.safeTransferFrom(msg.sender, address(this), cost);
            token.forceApprove(payments, cost);
            IPayments.PaymentItem memory item = IPayments.PaymentItem({
                paymentId: bytes32(0),
                recipient: safe,
                token: g.strikeToken,
                amount: cost,
                kind: KIND_OPTION_EXERCISE,
                documentHash: g.documentHash,
                // Unique per exercise: `exercised` rises by at least one share each time the strike is non-zero.
                jobNonce: keccak256(abi.encode(id, g.exercised)),
                executor: address(this)
            });
            paymentId = IPayments(payments).paymentId(item);
            item.paymentId = paymentId;
            IPayments(payments).send(item);
        }
        ICaptable(captable).issue(classId, msg.sender, shares, g.documentHash);
        emit Exercised(id, shares, cost, paymentId);
    }

    /// @inheritdoc IOptions
    function end(uint256 id, uint64 endedAt) external {
        _onlyBoard();
        OptionGrant memory g = _view(id);
        if (g.endedAt != 0 || g.cancelled) revert AlreadyEnded();
        if (endedAt < block.timestamp) revert InvalidSchedule();
        uint128 returned = g.shares - _vested(g, endedAt);
        grantsById[id].endedAt = endedAt;
        allocated -= returned;
        emit OptionsEnded(id, endedAt, returned);
    }

    /// @inheritdoc IOptions
    function lapse(uint256 id) external {
        OptionGrant memory g = _view(id);
        if (g.grantee == address(0) || g.cancelled) revert NotLapsed();
        bool lapsed = (!g.accepted && block.timestamp > g.offerExpiresAt) || block.timestamp > g.expiresAt
            || (g.endedAt != 0 && block.timestamp > _windowEnd(g));
        if (!lapsed) revert NotLapsed();
        uint128 returned = (g.endedAt != 0 ? _vested(g, g.endedAt) : g.shares) - g.exercised;
        grantsById[id].cancelled = true;
        allocated -= returned;
        emit OptionsLapsed(id, returned);
    }

    /// @inheritdoc IOptions
    /// @dev O(1). Every call ends every grant made so far, each at the time of the call that ended it, so a grant
    /// made after an earlier call (a sale closes the Captable, so none is expected) ends at the next call's time
    /// and keeps O1, and a grant ended by an earlier call keeps its exit time.
    function endAllForExit() external {
        if (msg.sender != ICaptable(captable).exits()) revert OnlyExits();
        _exitAt[_exitCalls] = uint64(block.timestamp);
        ++_exitCalls;
        _exitLastId = _lastId;
        allocated = 0;
        emit AllEndedForExit();
    }

    /// @inheritdoc IOptions
    function vestedOf(uint256 id, uint64 t) external view returns (uint128) {
        return _vested(_view(id), t);
    }

    /// @inheritdoc IOptions
    function getGrant(uint256 id) external view returns (OptionGrant memory) {
        return _view(id);
    }

    function _onlyBoard() internal view {
        if (msg.sender != safe) revert OnlyBoard();
    }

    /// @dev The grant as it stands, with the exit marker applied to every grant made before the latest
    /// `endAllForExit` call: cancelled, and ended at the time of the call that ended it unless it was already
    /// ended earlier (a later end date the Board set is cut to the exit, so nothing vests after a sale).
    function _view(uint256 id) internal view returns (OptionGrant memory g) {
        g = grantsById[id];
        if (id != 0 && id <= _exitLastId && !g.cancelled) {
            g.cancelled = true;
            uint64 exitAt = _exitAt[_exitCallOf[id]];
            if (g.endedAt == 0 || g.endedAt > exitAt) g.endedAt = exitAt;
        }
    }

    function _windowEnd(OptionGrant memory g) internal pure returns (uint256) {
        return uint256(g.endedAt) + uint256(g.exerciseWindowDays) * 1 days;
    }

    /// @dev Vesting's calendar-month formula, frozen at `endedAt`.
    function _vested(OptionGrant memory g, uint64 t) internal pure returns (uint128) {
        if (g.endedAt != 0 && t > g.endedAt) t = g.endedAt;
        if (t < g.cliff) return 0;
        if (t >= g.end) return g.shares;
        return uint128(uint256(g.shares) * Calendar.monthsBetween(g.start, t) / Calendar.monthsBetween(g.start, g.end));
    }
}
// forge-lint: disable-end(reentrancy-events)
// forge-lint: disable-end(block-timestamp)
// forge-lint: disable-end(unsafe-typecast)
