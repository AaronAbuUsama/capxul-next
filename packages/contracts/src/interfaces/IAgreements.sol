// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @title IAgreements
/// @notice Recurring pay against a budget (spec/agreements.md): a hat wearer offers, the payee's Safe
/// accepts the exact terms, pay accrues by the Calendar and is released in steps the payee collects.
/// Each offer reserves its figure in the budget through `IBudgets.commit`. Authority is
/// `IBudgets.authorised`; budget refusals (`UnknownBudget`, `OverBudget`, `BudgetIsClosed`) come from
/// Budgets.
interface IAgreements {
    /// @notice One agreement.
    struct Agreement {
        address safe;
        uint256 budgetId;
        address token; // the budget's token; fixed for the agreement's life
        address payee;
        uint128 rate; // token units per `period`
        uint8 period; // ICalendar.WEEK, MONTH or YEAR
        uint128 collected;
        uint128 reserved; // what is committed in the budget now
        uint256 earnedScaled; // pay accrued up to `accruedAt`, in ICalendar.SCALE units
        uint256 releasedScaled; // the part of `earnedScaled` earned by the last whole release step
        uint64 startsAt; // accrual start: the later of the start date and the acceptance
        uint64 step; // release step in seconds, or MONTHLY
        uint64 offerExpiresAt; // the payee must accept before this time
        uint64 accruedAt; // accrual checkpoint; a future value is the start date
        uint64 endsAt; // exclusive end; 0 while open-ended
        uint64 pendingAt; // effective date of a lowering, 0 if none
        uint128 pendingRate; // in the agreement's period
        uint64 collections; // number of collections, so each payment has its own job nonce
        bool accepted;
        bool paused;
        bool closed; // ended, withdrawn or expired: reservation freed
        bytes32 documentHash; // hash of the terms document, stamped on each payment
    }

    event AgreementOffered(
        address indexed safe,
        uint256 indexed budgetId,
        uint256 indexed id,
        address token,
        address payee,
        uint128 rate,
        uint8 period,
        uint64 startsAt,
        uint64 step,
        uint64 offerExpiresAt,
        bytes32 documentHash
    );
    event AgreementAccepted(address indexed safe, uint256 indexed id, address indexed payee, uint64 startsAt);
    event OfferWithdrawn(address indexed safe, uint256 indexed id);
    event RateChanged(address indexed safe, uint256 indexed id, uint128 rate, uint64 effectiveAt);
    event RateChangeCancelled(address indexed safe, uint256 indexed id);
    event AgreementPaused(address indexed safe, uint256 indexed id);
    event AgreementResumed(address indexed safe, uint256 indexed id);
    event AgreementEnded(address indexed safe, uint256 indexed id, uint64 endsAt);
    event ReservationReleased(address indexed safe, uint256 indexed budgetId, uint256 indexed id, uint128 amount);
    event Collected(
        address indexed safe,
        uint256 indexed id,
        address indexed payee,
        address token,
        uint128 amount,
        bytes32 paymentId
    );

    error NotAuthorised(uint256 budgetId, address who);
    error NotThePayee();
    error TooManyAgreements();
    error InvalidAgreement();
    error InvalidDate();
    error InvalidRate();
    error InvalidStep();
    error InvalidAmount();
    error PendingChange();
    error NoPendingChange();
    error AlreadyEnded();
    error AlreadyPaused();
    error NotPaused();
    error NotAccepted();
    error AlreadyAccepted();
    error OfferExpired();
    error TermsMismatch();
    error InsufficientReleased(uint128 available, uint128 requested);
    error ReentrantCall();

    // ------------------------------------------------------------------ Wiring

    /// @notice The release step that releases each calendar month's pay at 00:00 UTC on the 1st.
    /// @return `type(uint64).max`.
    function MONTHLY() external view returns (uint64);

    /// @notice The most open agreements (running or offered) one budget may have.
    /// @return 64.
    function MAX_OPEN_AGREEMENTS() external view returns (uint256);

    /// @notice The Budgets contract that holds every reservation and pays every collection.
    /// @return The Budgets address.
    function budgets() external view returns (address);

    /// @notice The number of agreements offered; ids run from 1.
    /// @return The last agreement id.
    function agreementCount() external view returns (uint256);

    // ------------------------------------------------------------------ Budget's hat

    /// @notice Offers an agreement paid from `budgetId` in the budget's token. Settles the budget first,
    /// then reserves `reservation(...)` through `IBudgets.commit`. A period above YEAR reverts the
    /// Calendar's `ICalendar.InvalidPeriod(period)`. No self-offers (27 Oct ruling): a payee equal to the
    /// caller reverts `InvalidAgreement`. Emits `AgreementOffered`, and `AgreementEnded` if an end is set.
    /// @param budgetId The budget it is paid from.
    /// @param payee The payee's Safe; never zero, never the caller.
    /// @param rate Token units per `period`; never 0.
    /// @param period ICalendar.WEEK, MONTH or YEAR.
    /// @param startsAt The start date, or 0 for now; never in the past.
    /// @param endsAt The exclusive end, or 0 for open-ended.
    /// @param step The release step in seconds, or MONTHLY; never 0.
    /// @param offerExpiresAt When the offer lapses; in the future and not after `endsAt`.
    /// @param documentHash The hash of the terms document; never zero.
    /// @return id The agreement id.
    function offer(
        uint256 budgetId,
        address payee,
        uint128 rate,
        uint8 period,
        uint64 startsAt,
        uint64 endsAt,
        uint64 step,
        uint64 offerExpiresAt,
        bytes32 documentHash
    )
        external
        returns (uint256 id);

    /// @notice Withdraws an offer the payee has not accepted and frees its reservation. Emits
    /// `OfferWithdrawn` and `ReservationReleased`.
    /// @param id The agreement.
    function withdrawOffer(uint256 id) external;

    /// @notice Changes the rate from `effectiveAt`. A raise commits the difference of the period figures
    /// now; a lowering releases it once the agreement is next brought up to date after `effectiveAt`.
    /// Emits `RateChanged`.
    /// @param id The agreement.
    /// @param newRate The new rate in the agreement's period.
    /// @param effectiveAt When the new rate applies.
    function changeRate(uint256 id, uint128 newRate, uint64 effectiveAt) external;

    /// @notice Cancels a pending rate lowering. Emits `RateChangeCancelled`.
    /// @param id The agreement.
    function cancelChange(uint256 id) external;

    /// @notice Stops accrual until `resume`. Emits `AgreementPaused`.
    /// @param id The agreement.
    function pause(uint256 id) external;

    /// @notice Restarts accrual after `pause`. Emits `AgreementResumed`.
    /// @param id The agreement.
    function resume(uint256 id) external;

    /// @notice Sets or brings forward the agreement's end. The reservation is released when the agreement
    /// is next brought up to date after `endsAt`. Emits `AgreementEnded`.
    /// @param id The agreement.
    /// @param endsAt The exclusive end.
    function end(uint256 id, uint64 endsAt) external;

    // ------------------------------------------------------------------ The payee

    /// @notice The payee's Safe accepts the exact terms before the offer expires. Pay accrues from the
    /// later of the start date and now. Emits `AgreementAccepted`.
    /// @param id The agreement.
    /// @param termsHash Must equal the agreement's document hash.
    function accept(uint256 id, bytes32 termsHash) external;

    /// @notice The payee collects released pay through `IBudgets.payReserved`, with job nonce
    /// `keccak256(abi.encode(address(this), id, collections))`. Emits `Collected`.
    /// @param id The agreement.
    /// @param amount The amount to collect; at most `availableOf(id)`.
    function collect(uint256 id, uint128 amount) external;

    // ------------------------------------------------------------------ Anyone

    /// @notice Brings up to date every open agreement of a budget whose end, lowering date or offer expiry
    /// has passed, frees what each releases and drops closed ones. Moves no money. Emits
    /// `ReservationReleased` for each release.
    /// @param budgetId The budget.
    function settle(uint256 budgetId) external;

    // ------------------------------------------------------------------ Views

    /// @notice What an agreement reserves in a budget of `budgetPeriod`: `Calendar.periodFigure`, or for a
    /// fixed term that pays less in total, the term's exact calendar pay rounded down.
    /// @param rate Token units per `period`.
    /// @param period ICalendar.WEEK, MONTH or YEAR.
    /// @param budgetPeriod ICalendar.BUDGET_MONTH, _QUARTER or _YEAR.
    /// @param startsAt The start date.
    /// @param endsAt The exclusive end, or 0 for open-ended.
    /// @return The reservation.
    function reservation(
        uint128 rate,
        uint8 period,
        uint8 budgetPeriod,
        uint64 startsAt,
        uint64 endsAt
    )
        external
        pure
        returns (uint128);

    /// @notice One agreement's stored terms and checkpoint.
    /// @param id The agreement.
    /// @return The agreement.
    function agreementOf(uint256 id) external view returns (Agreement memory);

    /// @notice Pay released and not yet collected, as of now.
    /// @param id The agreement.
    /// @return The collectable amount.
    function availableOf(uint256 id) external view returns (uint128);

    /// @notice Pay earned and not yet collected, as of now, released or not.
    /// @param id The agreement.
    /// @return The earned, uncollected amount.
    function earnedOf(uint256 id) external view returns (uint128);

    /// @notice A budget's open agreement ids (running or offered, settled or not).
    /// @param budgetId The budget.
    /// @return The open agreement ids.
    function openOf(uint256 budgetId) external view returns (uint256[] memory);
}
