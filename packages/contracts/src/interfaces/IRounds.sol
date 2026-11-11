// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @title IRounds
/// @notice A company's own fundraising (docs/planning/protocol-v4/spec/rounds.md): SAFE rounds (YC
/// post-money SAFE) and priced rounds (investors commit, the Board allocates, each investor pays and
/// receives shares in one call, decisions Q18.2), with NVCA broad-based weighted-average anti-dilution.
/// One clone per company; the Board check is `msg.sender == safe`. Holds no funds after any call.
/// @dev Prices are price units (the Captable's `PRICE_DECIMALS`, 6) per whole share. A round's token must
/// have exactly that many decimals, so token units are price units and a round price compares directly
/// with a class's conversion price (`InvalidRound` otherwise). A priced `pay` moves exactly
/// `shares * price` and issues exactly `shares` (R1, ruling D14); only SAFE conversion rounds down.
/// The Captable's refusals bubble unchanged, notably `ProposalPending(classId, until)` from `issue`
/// (ruling D6) and `UnknownClass(classId)` (ICaptable).
interface IRounds {
    struct SafeRound {
        address token;
        uint128 valuationCap;
        uint16 discountBps;
        uint64 closesAt;
        bytes32 documentHash;
        bool closed;
    }

    struct SafeNote {
        uint256 roundId;
        address investor;
        uint128 amount;
        bytes32 documentHash;
        bool converted;
    }

    /// @notice An investor's place in a SAFE round.
    struct SafeInvitation {
        uint128 maxAmount;
        /// @dev The sum of the investor's signed notes in the round.
        uint128 signed;
    }

    struct PricedRound {
        /// @dev Created by the company Governor before the round (a reserved matter).
        uint8 classId;
        address token;
        /// @dev Token units per share; > 0.
        uint128 price;
        uint128 maxShares;
        uint64 payBy;
        bytes32 documentHash;
        uint128 allocatedShares;
        uint128 issuedShares;
        bool closed;
        bool cancelled;
    }

    /// @notice An investor's place in a priced round.
    struct Position {
        uint128 maxAmount;
        uint128 committed;
        uint128 shares;
        bool paid;
    }

    /// @notice A class whose conversion price `close` lowered.
    struct Adjustment {
        uint8 classId;
        uint128 oldPrice;
        uint128 newPrice;
    }

    event SafeRoundCreated(
        uint256 indexed roundId,
        address token,
        uint128 valuationCap,
        uint16 discountBps,
        uint64 closesAt,
        bytes32 documentHash
    );
    event SafeInvited(uint256 indexed roundId, address indexed investor, uint128 maxAmount);
    event SafeSigned(
        uint256 indexed roundId,
        uint256 indexed noteId,
        address indexed investor,
        uint128 amount,
        bytes32 documentHash,
        bytes32 paymentId
    );
    event SafeRoundClosed(uint256 indexed roundId);
    event SafesConverted(uint256 indexed pricedRoundId, uint256[] noteIds, uint128[] shares);
    event PricedRoundCreated(
        uint256 indexed roundId,
        uint8 indexed classId,
        address token,
        uint128 price,
        uint128 maxShares,
        uint64 payBy,
        bytes32 documentHash
    );
    event Invited(uint256 indexed roundId, address indexed investor, uint128 maxAmount);
    event Committed(uint256 indexed roundId, address indexed investor, uint128 amount, bytes32 documentHash);
    event Allocated(uint256 indexed roundId, address indexed investor, uint128 shares);
    event Paid(uint256 indexed roundId, address indexed investor, uint128 shares, uint256 amount, bytes32 paymentId);
    event ConsentGiven(uint256 indexed roundId, uint8 indexed classId);
    event RoundClosed(uint256 indexed roundId, Adjustment[] adjustments);
    event RoundCancelled(uint256 indexed roundId);

    error AlreadyInitialized();
    error OnlyBoard();
    error NotInvited();
    error OverInvited(uint128 max, uint128 requested);
    error OverAllocated(uint128 left, uint128 requested);
    error NotAllocated();
    error AlreadyPaid();
    error PayByPassed(uint64 payBy);
    error RoundIsClosed();
    error RoundIsCancelled();
    error ConsentMissing(uint8 classId);
    error NotAffected(uint8 classId);
    error PaymentsStarted();
    error InvalidRound(string reason);

    /// @notice Sets the clone up once; the implementation cannot be initialised (I3).
    /// @param safe The company Safe (the Board).
    /// @param captable The company's Captable.
    /// @param payments The shared Payments contract.
    function initialize(address safe, address captable, address payments) external;

    // ---------------------------------------------------------------- SAFE rounds

    /// @notice Opens a SAFE round. Board only.
    /// @dev Reverts `InvalidRound` for a 0 cap, a discount of 10,000 or more, a past close date, or a token
    /// whose decimals are not `PRICE_DECIMALS`.
    /// @param token What investors pay in.
    /// @param valuationCap The post-money valuation cap, in price units.
    /// @param discountBps The discount on the next priced round's price.
    /// @param closesAt The last second a note can be signed.
    /// @param documentHash The round's SAFE form.
    /// @return roundId The new SAFE round.
    function createSafeRound(
        address token,
        uint128 valuationCap,
        uint16 discountBps,
        uint64 closesAt,
        bytes32 documentHash
    )
        external
        returns (uint256 roundId);

    /// @notice Invites an investor to a SAFE round up to `maxAmount`. Board only; the round must be open.
    /// @param roundId The SAFE round.
    /// @param investor The investor.
    /// @param maxAmount The most the investor may sign for in total.
    function inviteSafe(uint256 roundId, address investor, uint128 maxAmount) external;

    /// @notice An invited investor signs a SAFE before `closesAt`: pulls `amount` and pays it to the
    /// Safe through Payments (kind 6, the signed SAFE's hash), and records the note.
    /// @param roundId The SAFE round.
    /// @param amount What the investor pays; with earlier notes, at most the invitation.
    /// @param documentHash The investor's signed SAFE.
    /// @return noteId The new note.
    function signSafe(uint256 roundId, uint128 amount, bytes32 documentHash) external returns (uint256 noteId);

    /// @notice Closes a SAFE round: no more notes. Board only.
    /// @param roundId The SAFE round.
    function closeSafeRound(uint256 roundId) external;

    /// @notice Converts SAFE notes into the priced round's class, in that round's closing batch. Board
    /// only. Per note: `conversionPrice = min(valuationCap / companyCapitalization,
    /// price * (10,000 - discountBps) / 10,000)` rounded down to the price unit, and
    /// `shares = amount / conversionPrice` rounded down (the dust stays with the company); issued
    /// through the Captable issuer allowance. Reverts whole if any note was already converted
    /// (`InvalidRound`) or the Captable refuses (`ProposalPending`).
    /// @param noteIds The notes.
    /// @param pricedRoundId The priced round whose class and price they convert into.
    /// @param companyCapitalization Computed off chain and shown in the batch; excludes the pool top-up.
    function convertSafes(uint256[] calldata noteIds, uint256 pricedRoundId, uint256 companyCapitalization) external;

    // -------------------------------------------------------------- priced rounds

    /// @notice Opens a priced round selling `classId`. Board only.
    /// @dev Reverts `InvalidRound` for a 0 price or maximum, a past pay-by date, or a token whose decimals are
    /// not `PRICE_DECIMALS`.
    /// @param classId The class the company Governor created for the round.
    /// @param token What investors pay in.
    /// @param price Token units per share.
    /// @param maxShares The most shares the round may allocate.
    /// @param payBy The last second an allocated investor may pay.
    /// @param documentHash The round's terms.
    /// @return roundId The new priced round.
    function createPricedRound(
        uint8 classId,
        address token,
        uint128 price,
        uint128 maxShares,
        uint64 payBy,
        bytes32 documentHash
    )
        external
        returns (uint256 roundId);

    /// @notice Invites an investor to a priced round up to `maxAmount`. Board only; the round must be
    /// neither closed nor cancelled.
    /// @param roundId The priced round.
    /// @param investor The investor.
    /// @param maxAmount The most the investor may commit.
    function invite(uint256 roundId, address investor, uint128 maxAmount) external;

    /// @notice An invited investor records a commitment. No money moves.
    /// @param roundId The priced round.
    /// @param amount The commitment, at most the invitation.
    /// @param documentHash The investor's signed subscription.
    function commit(uint256 roundId, uint128 amount, bytes32 documentHash) external;

    /// @notice Allocates whole shares to a committed investor. Board only. The same batch sets the
    /// Captable issuer allowance for Rounds to every allocated share not yet issued.
    /// @param roundId The priced round.
    /// @param investor The investor.
    /// @param shares The shares; `allocatedShares + shares <= maxShares`.
    function allocate(uint256 roundId, address investor, uint128 shares) external;

    /// @notice An allocated investor pays before `payBy`: pulls exactly `shares * price`, pays it to the
    /// Safe through Payments (kind 5), and issues exactly `shares` in the same call (R1, R2).
    /// @param roundId The priced round.
    /// @return paymentId The Payments id of the payment.
    function pay(uint256 roundId) external returns (bytes32 paymentId);

    /// @notice A class Governor consents to a down round that lowers its class's conversion price.
    /// @dev Reverts `NotAffected` when the caller is no class's Governor or the class's conversion price
    /// is not above the round price.
    /// @param roundId The priced round.
    function consent(uint256 roundId) external;

    /// @notice Closes a priced round after `payBy`, or once every allocation is paid. Board only.
    /// For every earlier class whose conversion price is above `price` (each must have consented, or
    /// have no class Governor): `CP2 = CP1 * (A + B) / (A + C)`, `B = moneyRaised / CP1`,
    /// `C = issuedShares`, rounded down to the price unit, then `Captable.setConversionPrice`. Unpaid
    /// allocations lapse.
    /// @param roundId The priced round.
    /// @param deemedOutstandingA Shares deemed outstanding before the round, as converted, plus options;
    /// computed off chain and shown in the batch.
    function close(uint256 roundId, uint256 deemedOutstandingA) external;

    /// @notice Cancels a priced round before anyone has paid. Board only.
    /// @param roundId The priced round.
    function cancel(uint256 roundId) external;

    // ---------------------------------------------------------------------- views

    /// @notice The company Safe.
    /// @return The Safe's address.
    function safe() external view returns (address);

    /// @notice The company's Captable.
    /// @return The Captable's address.
    function captable() external view returns (address);

    /// @notice The shared Payments contract.
    /// @return The Payments address.
    function payments() external view returns (address);

    /// @notice A SAFE round.
    /// @param roundId The SAFE round.
    /// @return The round.
    function safeRound(uint256 roundId) external view returns (SafeRound memory);

    /// @notice An investor's SAFE invitation.
    /// @param roundId The SAFE round.
    /// @param investor The investor.
    /// @return The invitation.
    function safeInvitation(uint256 roundId, address investor) external view returns (SafeInvitation memory);

    /// @notice A SAFE note.
    /// @param noteId The note.
    /// @return The note.
    function safeNote(uint256 noteId) external view returns (SafeNote memory);

    /// @notice A priced round.
    /// @param roundId The priced round.
    /// @return The round.
    function pricedRound(uint256 roundId) external view returns (PricedRound memory);

    /// @notice An investor's position in a priced round.
    /// @param roundId The priced round.
    /// @param investor The investor.
    /// @return The position.
    function position(uint256 roundId, address investor) external view returns (Position memory);

    /// @notice Whether a class consented to a down round.
    /// @param roundId The priced round.
    /// @param classId The class.
    /// @return True once its class Governor consented.
    function consented(uint256 roundId, uint8 classId) external view returns (bool);
}
