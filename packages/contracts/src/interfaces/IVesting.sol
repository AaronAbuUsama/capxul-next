// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @title IVesting
/// @notice One shared contract that locks the unvested part of a shareholder's shares in their own wallet
/// (spec/vesting.md, Q7). Unlocks in calendar-month steps (Q8); a leaver's unvested shares are burned back into
/// the authorised headroom. A grant is created live with its shares (`grantAndIssue`) or offered on shares the
/// shareholder already owns and live only once they accept (ruling D4). Ported from Firm `VestingController.sol`.
/// @dev The Board of a grant is its Captable's Safe: `msg.sender == ICaptable(captable).safe()`. Grant ids start
/// at 1; `grantOf` returns 0 for none. Events lead with the company Safe (architecture.md, shared contracts).
interface IVesting {
    /// @notice A vesting grant.
    struct Grant {
        address captable;
        uint8 classId;
        address shareholder;
        uint128 amount; // shares under the schedule
        uint64 start;
        uint64 cliff; // may equal start (no cliff)
        uint64 end;
        uint64 offerExpiresAt; // 0 for a live grant; an offer lapses after it
        uint64 revokedAt; // 0 unless revoked; locked is frozen from then
        uint128 burned; // unvested shares burned at revocation
        bool accepted; // true for a live grant, or once the shareholder accepts
        bool accelerateOnExit; // single-trigger acceleration
        bytes32 documentHash; // the grant agreement; the last acceleration's document when accelerated
    }

    /// @notice A live grant was made with its shares issued in the same call.
    event Granted(address indexed safe, uint256 indexed id, address indexed shareholder, Grant grant);

    /// @notice A grant was offered on shares the shareholder already owns; it locks nothing until accepted.
    event GrantOffered(address indexed safe, uint256 indexed id, address indexed shareholder, Grant grant);

    /// @notice The shareholder accepted an offered grant; it locks from now on.
    event GrantAccepted(address indexed safe, uint256 indexed id);

    /// @notice A grant was revoked, effective at `effectiveAt`.
    event Revoked(address indexed safe, uint256 indexed id, uint64 effectiveAt);

    /// @notice A revocation was settled: `burned` unvested shares were burned through the Captable.
    event RevocationSettled(address indexed safe, uint256 indexed id, uint128 burned);

    /// @notice A grant's end was brought earlier (ruling D7). `newEnd` is the end as stored after the call.
    event Accelerated(address indexed safe, uint256 indexed id, uint64 newEnd, bytes32 documentHash);

    /// @notice A finished grant was cleared so the account can receive a new one.
    event Released(address indexed safe, uint256 indexed id);

    /// @notice An offer that was never accepted was deleted.
    event OfferLapsed(address indexed safe, uint256 indexed id);

    error OnlyBoard();
    error OnlyShareholder();
    error OnlyExits();
    error GrantExists(uint256 id);
    error InvalidSchedule();
    error TermsMismatch();
    error OfferExpired();
    error NotAccepted();
    error NotEnoughShares(uint128 unlocked, uint128 amount);
    error RevokeInPast();
    error FullyVested();
    error AlreadyRevoked();
    error NotEarlier(uint64 end, uint64 newEnd);
    error ZeroDocument();
    error NotYet(uint64 at);
    error UnknownGrant(uint256 id);

    /// @notice Issues `amount` new shares to the shareholder through `Captable.issue` under Vesting's issuer
    /// allowance and records an accepted grant, in one call. Only the Captable's Safe. Requires no live grant on
    /// the class (`GrantExists`), `amount > 0` and a valid schedule (`InvalidSchedule`); the issue is subject to
    /// E1 and ruling D6. Emits `Granted`.
    /// @param captable The company's Captable.
    /// @param classId The class.
    /// @param shareholder The receiver.
    /// @param amount The shares.
    /// @param start The schedule's start.
    /// @param cliff Nothing unlocks before it; `start <= cliff <= end`.
    /// @param end Everything is unlocked from it; at least one month after `start`, or `cliff == end`.
    /// @param accelerateOnExit Whether an approved sale ends the schedule.
    /// @param documentHash The grant agreement.
    /// @return id The grant's id.
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
        returns (uint256 id);

    /// @notice Offers a grant on shares the shareholder already owns (ruling D4). Issues no shares, and locks
    /// nothing until the shareholder accepts. Only the Captable's Safe. Same schedule checks as
    /// `grantAndIssue`, and `offerExpiresAt` in the future. Emits `GrantOffered`.
    /// @param captable The company's Captable.
    /// @param classId The class.
    /// @param shareholder The shareholder.
    /// @param amount The shares to put under the schedule.
    /// @param start The schedule's start.
    /// @param cliff Nothing unlocks before it.
    /// @param end Everything is unlocked from it.
    /// @param offerExpiresAt The offer lapses after it.
    /// @param accelerateOnExit Whether an approved sale ends the schedule.
    /// @param documentHash The grant agreement the shareholder signs.
    /// @return id The grant's id.
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
        returns (uint256 id);

    /// @notice The shareholder accepts an offered grant's exact terms, on or before `offerExpiresAt`. Requires
    /// `termsHash == documentHash` (`TermsMismatch`), no live grant on the class (`GrantExists`) and at least
    /// `amount` unlocked shares of the class (`NotEnoughShares`). Emits `GrantAccepted`.
    /// @param id The grant.
    /// @param termsHash The document hash the shareholder signs.
    function acceptGrant(uint256 id, bytes32 termsHash) external;

    /// @notice Revokes an accepted grant from `effectiveAt` (now or later, V3). Vesting continues until then;
    /// the shares locked at `effectiveAt` are burned by `settleRevocation`, at once when `effectiveAt` is now.
    /// Only the Captable's Safe. Reverts `NotAccepted` for an offer, `AlreadyRevoked`, `RevokeInPast`, and
    /// `FullyVested` when nothing is locked at `effectiveAt`. Emits `Revoked` (and `RevocationSettled` when it
    /// burns at once).
    /// @param id The grant.
    /// @param effectiveAt When the revocation takes effect.
    function revoke(uint256 id, uint64 effectiveAt) external;

    /// @notice Burns the shares locked at a revocation's effective date through `Captable.burnUnvested`.
    /// Anyone, at or after the effective date (`NotYet`); does nothing once settled. Emits `RevocationSettled`.
    /// @param id The grant.
    function settleRevocation(uint256 id) external;

    /// @notice Brings a grant's end earlier (ruling D7): `end = max(newEnd, start)`, `cliff = min(cliff, end)`,
    /// and `cliff = end` when the new end is under one month from the start. Moves no shares. Only the
    /// Captable's Safe; `newEnd < end` (`NotEarlier`), `documentHash != 0` (`ZeroDocument`), not revoked.
    /// Emits `Accelerated`.
    /// @param id The grant.
    /// @param newEnd The requested end.
    /// @param documentHash The document that authorises the acceleration.
    function accelerate(uint256 id, uint64 newEnd, bytes32 documentHash) external;

    /// @notice At an approved sale, accelerates the grant to now if it accelerates on exit. Only the Captable's
    /// Exits. Does nothing, never reverts, when the grant is not accepted, revoked, has no `accelerateOnExit` or
    /// has already ended. Emits `Accelerated` when it acts.
    /// @param id The grant.
    function accelerateForExit(uint256 id) external;

    /// @notice Clears a finished grant (ended, or its revocation settled) so the account can receive a new
    /// one. Anyone. Emits `Released`.
    /// @param id The grant.
    function release(uint256 id) external;

    /// @notice Deletes an offer that was not accepted by `offerExpiresAt`. Anyone, after it. Emits `OfferLapsed`.
    /// @param id The grant.
    function lapse(uint256 id) external;

    /// @notice The shares of a class locked for an account at time `t` under its live grant; 0 with no grant
    /// or an unaccepted offer. Never increases with `t` (V1) and never depends on the balance (V5).
    /// @param captable The Captable.
    /// @param classId The class.
    /// @param account The shareholder.
    /// @param t The time.
    /// @return The locked shares.
    function lockedOf(address captable, uint8 classId, address account, uint64 t) external view returns (uint128);

    /// @notice A grant as stored. Reverts `UnknownGrant`.
    /// @param id The grant.
    /// @return The grant.
    function getGrant(uint256 id) external view returns (Grant memory);

    /// @notice The live (accepted, not released) grant of an account on a class, or 0.
    /// @param captable The Captable.
    /// @param classId The class.
    /// @param shareholder The shareholder.
    /// @return The grant id, or 0.
    function grantOf(address captable, uint8 classId, address shareholder) external view returns (uint256);
}
