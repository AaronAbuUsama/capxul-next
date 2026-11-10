// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { ICaptable } from "../interfaces/ICaptable.sol";
import { IVesting } from "../interfaces/IVesting.sol";
import { Calendar } from "../libraries/Calendar.sol";

/// @title Vesting
/// @notice One shared contract that locks the unvested part of a shareholder's shares in their own wallet
/// (spec/vesting.md, Q7, Q8). Ported from Firm `VestingController.sol`: calendar-month steps, locked rounds up,
/// revocation burns back into the authorised headroom, and a grant on shares already owned needs the
/// shareholder's acceptance (D4).
/// @dev The Board of a grant is its Captable's Safe. `_scheduleLocked` and `_acceleratedSchedule` are the pure
/// maths with the Calendar readings passed in, so Halmos proves V1 and V6 on the formula alone. Every function
/// is checks, then effects (storage and events), then its one interaction with the grant's Captable.
// forge-lint: disable-start(block-timestamp) -- grant dates are calendar dates; seconds of validator drift change nothing
contract Vesting is IVesting {
    uint256 internal _lastId;
    mapping(uint256 id => Grant) internal _grants;

    /// @inheritdoc IVesting
    mapping(address captable => mapping(uint8 classId => mapping(address shareholder => uint256 id)))
        public
        override grantOf;

    // ---------------------------------------------------------------------------------------------------
    // Create
    // ---------------------------------------------------------------------------------------------------

    /// @inheritdoc IVesting
    function grantAndIssue(
        address captable,
        uint8 classId,
        address shareholder,
        uint128 amount,
        uint64 start,
        uint64 cliff,
        uint64 end,
        bool accelerateOnExit,
        bytes32 documentHash
    )
        external
        returns (uint256 id)
    {
        address safe = _onlyBoard(captable);
        _checkSchedule(amount, start, cliff, end);
        uint256 live = grantOf[captable][classId][shareholder];
        if (live != 0) revert GrantExists(live);
        id = _store(
            Grant(
                captable, classId, shareholder, amount, start, cliff, end, 0, 0, 0, true, accelerateOnExit, documentHash
            )
        );
        grantOf[captable][classId][shareholder] = id;
        emit Granted(safe, id, shareholder, _grants[id]);
        ICaptable(captable).issue(classId, shareholder, amount, documentHash);
    }

    /// @inheritdoc IVesting
    function offerGrant(
        address captable,
        uint8 classId,
        address shareholder,
        uint128 amount,
        uint64 start,
        uint64 cliff,
        uint64 end,
        uint64 offerExpiresAt,
        bool accelerateOnExit,
        bytes32 documentHash
    )
        external
        returns (uint256 id)
    {
        address safe = _onlyBoard(captable);
        _checkSchedule(amount, start, cliff, end);
        if (offerExpiresAt <= block.timestamp) revert InvalidSchedule();
        id = _store(
            Grant(
                captable,
                classId,
                shareholder,
                amount,
                start,
                cliff,
                end,
                offerExpiresAt,
                0,
                0,
                false,
                accelerateOnExit,
                documentHash
            )
        );
        emit GrantOffered(safe, id, shareholder, _grants[id]);
    }

    /// @inheritdoc IVesting
    function acceptGrant(uint256 id, bytes32 termsHash) external {
        Grant storage g = _get(id);
        if (msg.sender != g.shareholder) revert OnlyShareholder();
        if (g.accepted) revert GrantExists(id);
        if (block.timestamp > g.offerExpiresAt) revert OfferExpired();
        if (termsHash != g.documentHash) revert TermsMismatch();
        uint256 live = grantOf[g.captable][g.classId][msg.sender];
        if (live != 0) revert GrantExists(live);
        uint256 held = IERC20(address(ICaptable(g.captable).getClass(g.classId).token)).balanceOf(msg.sender);
        if (held < g.amount) revert NotEnoughShares(SafeCast.toUint128(held), g.amount);
        g.accepted = true;
        grantOf[g.captable][g.classId][msg.sender] = id;
        emit GrantAccepted(ICaptable(g.captable).safe(), id);
    }

    // ---------------------------------------------------------------------------------------------------
    // Revoke, accelerate
    // ---------------------------------------------------------------------------------------------------

    /// @inheritdoc IVesting
    function revoke(uint256 id, uint64 effectiveAt) external {
        Grant storage g = _get(id);
        address safe = _onlyBoard(g.captable);
        if (!g.accepted) revert NotAccepted();
        if (g.revokedAt != 0) revert AlreadyRevoked();
        if (effectiveAt < block.timestamp) revert RevokeInPast();
        if (_lockedAt(g, effectiveAt) == 0) revert FullyVested();
        g.revokedAt = effectiveAt;
        emit Revoked(safe, id, effectiveAt);
        if (effectiveAt == block.timestamp) _settle(g, id, safe);
    }

    /// @inheritdoc IVesting
    function settleRevocation(uint256 id) external {
        Grant storage g = _get(id);
        if (g.revokedAt == 0) revert UnknownGrant(id);
        if (g.burned != 0) return;
        if (block.timestamp < g.revokedAt) revert NotYet(g.revokedAt);
        _settle(g, id, ICaptable(g.captable).safe());
    }

    /// @inheritdoc IVesting
    function accelerate(uint256 id, uint64 newEnd, bytes32 documentHash) external {
        Grant storage g = _get(id);
        address safe = _onlyBoard(g.captable);
        if (g.revokedAt != 0) revert AlreadyRevoked();
        if (documentHash == 0) revert ZeroDocument();
        if (newEnd >= g.end) revert NotEarlier(g.end, newEnd);
        _accelerate(g, newEnd);
        g.documentHash = documentHash;
        emit Accelerated(safe, id, g.end, documentHash);
    }

    /// @inheritdoc IVesting
    function accelerateForExit(uint256 id) external {
        Grant storage g = _get(id);
        if (msg.sender != ICaptable(g.captable).exits()) revert OnlyExits();
        if (!g.accepted || g.revokedAt != 0 || !g.accelerateOnExit || block.timestamp >= g.end) return;
        _accelerate(g, SafeCast.toUint64(block.timestamp));
        emit Accelerated(ICaptable(g.captable).safe(), id, g.end, g.documentHash);
    }

    // ---------------------------------------------------------------------------------------------------
    // Clean up
    // ---------------------------------------------------------------------------------------------------

    /// @inheritdoc IVesting
    function release(uint256 id) external {
        Grant storage g = _get(id);
        if (!g.accepted) revert NotAccepted();
        if (grantOf[g.captable][g.classId][g.shareholder] != id) revert UnknownGrant(id); // already released
        if (g.revokedAt != 0) {
            if (g.burned == 0) revert NotYet(g.revokedAt);
        } else if (block.timestamp < g.end) {
            revert NotYet(g.end);
        }
        address safe = ICaptable(g.captable).safe();
        delete grantOf[g.captable][g.classId][g.shareholder];
        emit Released(safe, id);
    }

    /// @inheritdoc IVesting
    function lapse(uint256 id) external {
        Grant storage g = _get(id);
        if (g.accepted) revert GrantExists(id);
        if (block.timestamp <= g.offerExpiresAt) revert NotYet(g.offerExpiresAt);
        address safe = ICaptable(g.captable).safe();
        delete _grants[id];
        emit OfferLapsed(safe, id);
    }

    // ---------------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------------

    /// @inheritdoc IVesting
    function lockedOf(address captable, uint8 classId, address account, uint64 t) external view returns (uint128) {
        uint256 id = grantOf[captable][classId][account];
        if (id == 0) return 0;
        return _lockedAt(_grants[id], t);
    }

    /// @inheritdoc IVesting
    function getGrant(uint256 id) external view returns (Grant memory) {
        return _get(id);
    }

    // ---------------------------------------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------------------------------------

    function _onlyBoard(address captable) internal view returns (address safe) {
        safe = ICaptable(captable).safe();
        if (msg.sender != safe) revert OnlyBoard();
    }

    function _get(uint256 id) internal view returns (Grant storage g) {
        g = _grants[id];
        if (g.captable == address(0)) revert UnknownGrant(id);
    }

    function _store(Grant memory g) internal returns (uint256 id) {
        id = ++_lastId;
        _grants[id] = g;
    }

    /// @dev start <= cliff <= end, amount > 0, and a whole month between start and end unless all at once.
    function _checkSchedule(uint128 amount, uint64 start, uint64 cliff, uint64 end) internal pure {
        if (amount == 0 || cliff < start || end < cliff) revert InvalidSchedule();
        if (cliff != end && Calendar.monthsBetween(start, end) == 0) revert InvalidSchedule();
    }

    /// @dev Locked at `t` for a grant: the schedule, frozen at the revocation date, 0 once the burn has run.
    function _lockedAt(Grant storage g, uint64 t) internal view returns (uint128) {
        if (!g.accepted) return 0;
        if (g.revokedAt != 0) {
            if (t >= g.revokedAt) {
                if (g.burned != 0) return 0;
                t = g.revokedAt;
            }
        }
        return _scheduleLocked(
            g.amount, g.cliff, g.end, t, Calendar.monthsBetween(g.start, t), Calendar.monthsBetween(g.start, g.end)
        );
    }

    function _accelerate(Grant storage g, uint64 newEnd) internal {
        (g.end, g.cliff) = _acceleratedSchedule(
            g.start, g.cliff, newEnd, Calendar.monthsBetween(g.start, newEnd < g.start ? g.start : newEnd)
        );
    }

    /// @dev Burns what was locked at the revocation date through the Captable.
    function _settle(Grant storage g, uint256 id, address safe) internal {
        uint128 amount = _lockedAt(g, g.revokedAt);
        g.burned = amount;
        emit RevocationSettled(safe, id, amount);
        ICaptable(g.captable).burnUnvested(g.classId, g.shareholder, amount);
    }

    /// @notice The schedule's locked amount at `t` (spec/vesting.md "The schedule"), ignoring acceptance and
    /// revocation: `amount` before `cliff`, 0 from `end`, else `amount - floor(amount * monthsToT / monthsToEnd)`.
    /// Arguments: (amount, cliff, end, t, monthsToT = `Calendar.monthsBetween(start, t)`,
    /// monthsToEnd = `Calendar.monthsBetween(start, end)`, at least 1 whenever `cliff < end`).
    function _scheduleLocked(
        uint128 amount,
        uint64 cliff,
        uint64 end,
        uint64 t,
        uint256 monthsToT,
        uint256 monthsToEnd
    )
        internal
        pure
        returns (uint128)
    {
        if (t < cliff) return amount;
        if (t >= end || monthsToEnd == 0) return 0;
        uint256 vested = uint256(amount) * monthsToT / monthsToEnd;
        return vested >= amount ? 0 : amount - SafeCast.toUint128(vested);
    }

    /// @notice The schedule after `accelerate(newEnd)` (ruling D7): `end' = max(newEnd, start)`,
    /// `cliff' = min(cliff, end')`, and `cliff' = end'` when `monthsToNewEnd == 0`. Arguments: (start, cliff,
    /// newEnd, monthsToNewEnd = `Calendar.monthsBetween(start, max(newEnd, start))`); returns (end', cliff').
    function _acceleratedSchedule(
        uint64 start,
        uint64 cliff,
        uint64 newEnd,
        uint256 monthsToNewEnd
    )
        internal
        pure
        returns (uint64 end, uint64 cliff_)
    {
        end = newEnd < start ? start : newEnd;
        cliff_ = monthsToNewEnd == 0 || cliff > end ? end : cliff;
    }
}
// forge-lint: disable-end(block-timestamp)
