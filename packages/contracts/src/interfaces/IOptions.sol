// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @title IOptions
/// @notice A company's option pool on one class (spec/options.md). The Board grants options from the pool, the
/// grantee accepts the exact terms (Q18.1), exercises what has vested by paying the strike to the company
/// through Payments (kind 7), and receives the shares by `Captable.issue` in the same transaction. One clone per
/// company; it holds no tokens after any call.
/// @dev The Board check is `msg.sender == safe()`. Vesting of options uses Vesting's calendar-month schedule.
/// Grant ids start at 1.
interface IOptions {
    /// @notice An option grant.
    struct OptionGrant {
        address grantee;
        uint128 shares;
        uint128 exercised;
        address strikeToken;
        uint128 strikePrice; // strikeToken units per share
        uint64 start;
        uint64 cliff;
        uint64 end;
        uint64 offerExpiresAt;
        uint64 expiresAt; // latest exercise date
        uint64 endedAt; // 0 unless ended; vesting stops here
        uint32 exerciseWindowDays; // after endedAt, vested options stay exercisable this long
        bool accepted;
        bool cancelled;
        bytes32 documentHash;
    }

    /// @notice The pool was set.
    event PoolSet(uint128 pool);

    /// @notice Options were offered to a grantee.
    event OptionsGranted(uint256 indexed id, address indexed grantee, OptionGrant grant);

    /// @notice The grantee accepted the grant's terms.
    event OptionsAccepted(uint256 indexed id, address indexed grantee);

    /// @notice Options were exercised: `paid` of the strike token went to the Safe as payment `paymentId`.
    event Exercised(uint256 indexed id, uint128 shares, uint256 paid, bytes32 paymentId);

    /// @notice A grant was ended at `endedAt`; `returned` unvested shares went back to the pool.
    event OptionsEnded(uint256 indexed id, uint64 endedAt, uint128 returned);

    /// @notice A grant lapsed; `returned` unexercised shares went back to the pool.
    event OptionsLapsed(uint256 indexed id, uint128 returned);

    /// @notice Every grant was ended at a settled sale.
    event AllEndedForExit();

    error AlreadyInitialized();
    error OnlyBoard();
    error OnlyGrantee();
    error OnlyExits();
    error PoolExceeded(uint128 left, uint128 requested);
    error PoolBelowAllocated(uint128 allocated);
    error InvalidSchedule();
    error TermsMismatch();
    error OfferExpired();
    error NotAccepted();
    error NotVested(uint128 vested, uint128 exercised, uint128 requested);
    error ExerciseWindowClosed();
    error AlreadyEnded();
    error NotLapsed();

    /// @notice Sets the wiring once. The implementation cannot be initialised (I3). Reverts
    /// `AlreadyInitialized` on a second call.
    /// @param safe_ The company Safe, which is the Board.
    /// @param captable_ The company's Captable.
    /// @param payments_ The shared Payments contract.
    /// @param classId_ The pool's class.
    function initialize(address safe_, address captable_, address payments_, uint8 classId_) external;

    /// @notice Sets the pool. Only the Safe; `amount >= allocated` (`PoolBelowAllocated`). The same Board batch
    /// sets `Captable.setIssuerAllowance(options, classId, amount)`. Emits `PoolSet`.
    /// @param amount The shares reserved for options.
    function setPool(uint128 amount) external;

    /// @notice Offers options from the pool. Only the Safe; `shares <= pool - allocated` (`PoolExceeded`), a
    /// valid schedule (as Vesting) and `expiresAt > end` (`InvalidSchedule`). Adds to `allocated`.
    /// Emits `OptionsGranted`.
    /// @param grantee The person granted the options.
    /// @param shares The options, one share each.
    /// @param strikeToken The token the strike is paid in.
    /// @param strikePrice The strike in `strikeToken` units per share.
    /// @param start The vesting start.
    /// @param cliff Nothing vests before it.
    /// @param end Everything is vested from it.
    /// @param offerExpiresAt The offer lapses after it unaccepted.
    /// @param expiresAt The latest exercise date.
    /// @param exerciseWindowDays How long vested options stay exercisable after the grant is ended.
    /// @param documentHash The option agreement the grantee signs.
    /// @return id The grant's id.
    function grant(
        address grantee,
        uint128 shares,
        address strikeToken,
        uint128 strikePrice,
        uint64 start,
        uint64 cliff,
        uint64 end,
        uint64 offerExpiresAt,
        uint64 expiresAt,
        uint32 exerciseWindowDays,
        bytes32 documentHash
    )
        external
        returns (uint256 id);

    /// @notice The grantee accepts the exact terms, on or before `offerExpiresAt` (`OfferExpired`), with
    /// `termsHash == documentHash` (`TermsMismatch`). Emits `OptionsAccepted`.
    /// @param id The grant.
    /// @param termsHash The document hash the grantee signs.
    function accept(uint256 id, bytes32 termsHash) external;

    /// @notice Exercises vested options: pulls `shares * strikePrice` of the strike token from the grantee, pays
    /// it to the Safe through Payments (kind 7, the grant's document hash, executor this contract), then issues
    /// the shares by `Captable.issue` under this contract's issuer allowance. Reverts `ProposalPending` (bubbled)
    /// while a proposal is pending in the class (ruling D6). Only the grantee; the grant must be accepted
    /// (`NotAccepted`), and now at or before `expiresAt` and, once ended, `endedAt + window`
    /// (`ExerciseWindowClosed`). The pool shrinks on exercise (27 Oct ruling): `pool` and `allocated` both
    /// fall by `shares`, as the issuer allowance does. Emits `Exercised`.
    /// @param id The grant.
    /// @param shares The options to exercise; `exercised + shares <= vestedOf(id, now)` (O1, `NotVested`).
    function exercise(uint256 id, uint128 shares) external;

    /// @notice Ends a grant at `endedAt` (now or later): vesting stops there, the unvested options return to the
    /// pool, and the vested ones stay exercisable for the window. Only the Safe. Emits `OptionsEnded`.
    /// @param id The grant.
    /// @param endedAt When the grantee leaves.
    function end(uint256 id, uint64 endedAt) external;

    /// @notice Returns a grant's unexercised options to the pool once its offer expired unaccepted, or its
    /// window or `expiresAt` passed (`NotLapsed` otherwise). Anyone. Emits `OptionsLapsed`.
    /// @param id The grant.
    function lapse(uint256 id) external;

    /// @notice At a settled sale, ends every grant so no option is exercisable afterwards (the waterfall paid
    /// the in-the-money ones net of strike). Only the Captable's Exits. Emits `AllEndedForExit`.
    function endAllForExit() external;

    /// @notice The options of a grant vested at `t`: `shares - locked(t)` by Vesting's calendar-month formula,
    /// frozen at `endedAt`.
    /// @param id The grant.
    /// @param t The time.
    /// @return The vested options.
    function vestedOf(uint256 id, uint64 t) external view returns (uint128);

    /// @notice A grant as stored.
    /// @param id The grant.
    /// @return The grant.
    function getGrant(uint256 id) external view returns (OptionGrant memory);

    /// @notice The company Safe.
    /// @return The Safe.
    function safe() external view returns (address);

    /// @notice The company's Captable.
    /// @return The Captable.
    function captable() external view returns (address);

    /// @notice The shared Payments contract.
    /// @return Payments.
    function payments() external view returns (address);

    /// @notice The pool's class.
    /// @return The class id.
    function classId() external view returns (uint8);

    /// @notice Shares still reserved for options (O2); exercised options leave the pool.
    /// @return The pool.
    function pool() external view returns (uint128);

    /// @notice The sum of live grants' unexercised options (O2).
    /// @return Allocated options.
    function allocated() external view returns (uint128);
}
