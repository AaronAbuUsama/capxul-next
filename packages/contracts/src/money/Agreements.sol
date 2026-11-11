// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IAgreements } from "../interfaces/IAgreements.sol";
import { IBudgets } from "../interfaces/IBudgets.sol";
import { ICalendar } from "../interfaces/ICalendar.sol";
import { Calendar } from "../libraries/Calendar.sol";

/// @title Agreements
/// @notice Recurring pay against a budget (spec/agreements.md). The agreement half of beta
/// `PayrollDepartments`, with its accrual and release maths kept exactly: a wearer of the budget's hat offers,
/// the payee's Safe accepts the exact terms, pay accrues by the Calendar and is released in steps the payee
/// collects. Every reservation lives in Budgets (`commit`, `release`) and every collection is paid by
/// `Budgets.payReserved`. Authority is `IBudgets.authorised`; this contract never reads Hats.
contract Agreements is IAgreements {
    // Lints silenced for the whole contract, each for one reason (J2's style: a comment changes no bytecode):
    // - block-timestamp: pay accrues by the clock; a validator's seconds of drift are inside the Calendar's tolerance.
    // - unsafe-typecast: every `uint64(block.timestamp)` fits until the year 584 billion; `uint128(term)` and
    //   `uint128(scaled / SCALE)` are bounded by the checked figure (`_toUint128`) and by earlier accrual.
    // - reentrancy-events, reentrancy-no-eth: D10's one-slot lock holds across every external call (A11).
    // - calls-loop, require-revert-in-loop: `_settle` is bounded by MAX_OPEN_AGREEMENTS and calls only Budgets.
    // - divide-before-multiply: the release boundary rounds down to a whole step on purpose (beta, kept exactly).
    // - missing-events-access-control: every write to `_agreements` is followed by its event.
    // - missing-zero-check: the deployer wires the real Budgets (Companies House); a zero address cannot pay.
    // - uninitialized-local: `uint256 i;` in `_settle` is the loop counter, zero by design.
    // forge-lint: disable-start(block-timestamp, unsafe-typecast, reentrancy-events, reentrancy-no-eth, calls-loop, require-revert-in-loop, divide-before-multiply, missing-events-access-control, missing-zero-check, uninitialized-local)
    /// @inheritdoc IAgreements
    uint64 public constant MONTHLY = type(uint64).max;

    /// @inheritdoc IAgreements
    uint256 public constant MAX_OPEN_AGREEMENTS = 64;

    /// @inheritdoc IAgreements
    address public immutable budgets;

    /// @inheritdoc IAgreements
    uint256 public agreementCount;

    mapping(uint256 id => Agreement) internal _agreements;
    mapping(uint256 budgetId => uint256[]) internal _open;
    /// @dev D10: the one-slot lock held by every state-changing function.
    bool private _entered;

    /// @param budgets_ The Budgets contract that holds every reservation and pays every collection.
    constructor(address budgets_) {
        budgets = budgets_;
    }

    modifier nonReentrant() {
        if (_entered) revert ReentrantCall();
        _entered = true;
        _;
        _entered = false;
    }

    // ------------------------------------------------------------------ Budget's hat

    /// @inheritdoc IAgreements
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
        nonReentrant
        returns (uint256 id)
    {
        // Budgets answers `authorised` with false and `budgetOf` with the zero record for an id it never
        // created (spec/budgets.md), so the budget is looked up first and an unknown one is named as such.
        IBudgets.Budget memory b = IBudgets(budgets).budgetOf(budgetId);
        if (b.safe == address(0)) revert IBudgets.UnknownBudget(budgetId);
        _requireAuthorised(budgetId);
        // F10: no self-offers.
        if (payee == address(0) || payee == msg.sender || rate == 0 || documentHash == bytes32(0)) {
            revert InvalidAgreement();
        }
        if (step == 0) revert InvalidStep();
        if (startsAt == 0) startsAt = uint64(block.timestamp);
        else if (startsAt < block.timestamp) revert InvalidDate();
        if (offerExpiresAt <= block.timestamp) revert InvalidDate();
        if (endsAt != 0 && (endsAt <= startsAt || offerExpiresAt > endsAt)) revert InvalidDate();

        uint128 reserved = reservation(rate, period, b.period, startsAt, endsAt);
        _settle(budgetId);
        if (_open[budgetId].length >= MAX_OPEN_AGREEMENTS) revert TooManyAgreements();
        IBudgets(budgets).commit(budgetId, reserved);

        id = ++agreementCount;
        Agreement storage a = _agreements[id];
        a.safe = b.safe;
        a.budgetId = budgetId;
        a.token = b.token;
        a.payee = payee;
        a.rate = rate;
        a.period = period;
        a.reserved = reserved;
        a.startsAt = startsAt;
        a.step = step;
        a.offerExpiresAt = offerExpiresAt;
        a.accruedAt = startsAt;
        a.endsAt = endsAt;
        a.documentHash = documentHash;
        _open[budgetId].push(id);
        _emitOffered(id, a);
    }

    /// @inheritdoc IAgreements
    function withdrawOffer(uint256 id) external nonReentrant {
        Agreement storage a = _agreementFor(id);
        if (a.accepted) revert AlreadyAccepted();
        _accrue(id, uint64(block.timestamp));
        if (a.closed) revert OfferExpired();
        _close(id, a);
        emit OfferWithdrawn(a.safe, id);
    }

    /// @inheritdoc IAgreements
    function changeRate(uint256 id, uint128 newRate, uint64 effectiveAt) external nonReentrant {
        Agreement storage a = _acceptedFor(id);
        // Accrue first: a lowering whose date has come takes effect, so the new rate is compared with the
        // rate the agreement pays now.
        _accrue(id, uint64(block.timestamp));
        if (newRate == 0 || newRate == a.rate) revert InvalidRate();
        if (a.endsAt != 0) revert AlreadyEnded();
        if (a.pendingAt != 0) revert PendingChange();
        if (newRate > a.rate) {
            _settle(a.budgetId);
            uint128 diff = _figure(a, newRate) - _figure(a, a.rate);
            IBudgets(budgets).commit(a.budgetId, diff);
            a.reserved += diff;
            a.rate = newRate;
            emit RateChanged(a.safe, id, newRate, uint64(block.timestamp));
        } else {
            if (effectiveAt < block.timestamp) revert InvalidDate();
            a.pendingAt = effectiveAt;
            a.pendingRate = newRate;
            _accrue(id, uint64(block.timestamp));
            emit RateChanged(a.safe, id, newRate, effectiveAt);
        }
    }

    /// @inheritdoc IAgreements
    function cancelChange(uint256 id) external nonReentrant {
        Agreement storage a = _acceptedFor(id);
        _accrue(id, uint64(block.timestamp));
        if (a.closed) revert AlreadyEnded();
        if (a.pendingAt == 0) revert NoPendingChange();
        a.pendingAt = 0;
        a.pendingRate = 0;
        emit RateChangeCancelled(a.safe, id);
    }

    /// @inheritdoc IAgreements
    function pause(uint256 id) external nonReentrant {
        Agreement storage a = _acceptedFor(id);
        if (a.paused) revert AlreadyPaused();
        _accrue(id, uint64(block.timestamp));
        if (a.closed) revert AlreadyEnded();
        a.paused = true;
        emit AgreementPaused(a.safe, id);
    }

    /// @inheritdoc IAgreements
    function resume(uint256 id) external nonReentrant {
        Agreement storage a = _acceptedFor(id);
        if (!a.paused) revert NotPaused();
        _accrue(id, uint64(block.timestamp));
        if (a.closed) revert AlreadyEnded();
        a.paused = false;
        emit AgreementResumed(a.safe, id);
    }

    /// @inheritdoc IAgreements
    function end(uint256 id, uint64 endsAt) external nonReentrant {
        Agreement storage a = _acceptedFor(id);
        if (a.endsAt != 0 && endsAt >= a.endsAt) revert AlreadyEnded();
        if (endsAt < block.timestamp) revert InvalidDate();
        _accrue(id, uint64(block.timestamp));
        a.endsAt = endsAt;
        emit AgreementEnded(a.safe, id, endsAt);
        _accrue(id, uint64(block.timestamp));
    }

    // ------------------------------------------------------------------ The payee

    /// @inheritdoc IAgreements
    function accept(uint256 id, bytes32 termsHash) external nonReentrant {
        Agreement storage a = _agreements[id];
        if (a.safe == address(0)) revert InvalidAgreement();
        if (msg.sender != a.payee) revert NotThePayee();
        if (a.accepted) revert AlreadyAccepted();
        if (a.closed || block.timestamp >= a.offerExpiresAt) revert OfferExpired();
        if (termsHash != a.documentHash) revert TermsMismatch();
        a.accepted = true;
        if (a.startsAt < block.timestamp) {
            a.startsAt = uint64(block.timestamp);
            a.accruedAt = uint64(block.timestamp);
        }
        emit AgreementAccepted(a.safe, id, a.payee, a.startsAt);
    }

    /// @inheritdoc IAgreements
    function collect(uint256 id, uint128 amount) external nonReentrant {
        Agreement storage a = _agreements[id];
        if (a.safe == address(0)) revert InvalidAgreement();
        if (msg.sender != a.payee) revert NotThePayee();
        if (!a.accepted) revert NotAccepted();
        if (amount == 0) revert InvalidAmount();
        _accrue(id, uint64(block.timestamp));
        uint128 available = _available(a.releasedScaled, a.collected);
        if (amount > available) revert InsufficientReleased(available, amount);
        a.collected += amount;
        uint64 index = a.collections++;

        bytes32 paymentId = IBudgets(budgets)
            .payReserved(a.budgetId, a.payee, amount, a.documentHash, keccak256(abi.encode(address(this), id, index)));
        emit Collected(a.safe, id, a.payee, a.token, amount, paymentId);
    }

    // ------------------------------------------------------------------ Anyone

    /// @inheritdoc IAgreements
    function settle(uint256 budgetId) external nonReentrant {
        _settle(budgetId);
    }

    // ------------------------------------------------------------------ Views

    /// @inheritdoc IAgreements
    function reservation(
        uint128 rate,
        uint8 period,
        uint8 budgetPeriod,
        uint64 startsAt,
        uint64 endsAt
    )
        public
        pure
        returns (uint128)
    {
        uint128 figure = _toUint128(Calendar.periodFigure(rate, period, budgetPeriod));
        if (endsAt == 0 || endsAt <= startsAt) return figure;
        uint256 term = Calendar.earned(rate, period, startsAt, endsAt) / ICalendar.SCALE;
        return term < figure ? uint128(term) : figure;
    }

    /// @inheritdoc IAgreements
    function agreementOf(uint256 id) external view returns (Agreement memory) {
        return _agreements[id];
    }

    /// @inheritdoc IAgreements
    function availableOf(uint256 id) external view returns (uint128) {
        Agreement memory a = _agreements[id];
        (, uint256 released) = _project(a, uint64(block.timestamp));
        return _available(released, a.collected);
    }

    /// @inheritdoc IAgreements
    function earnedOf(uint256 id) external view returns (uint128) {
        Agreement memory a = _agreements[id];
        (uint256 earned,) = _project(a, uint64(block.timestamp));
        return _available(earned, a.collected);
    }

    /// @inheritdoc IAgreements
    function openOf(uint256 budgetId) external view returns (uint256[] memory) {
        return _open[budgetId];
    }

    // ------------------------------------------------------------------ Internal

    function _requireAuthorised(uint256 budgetId) private view {
        if (!IBudgets(budgets).authorised(budgetId, msg.sender)) revert NotAuthorised(budgetId, msg.sender);
    }

    /// @dev An agreement the caller may act on: it exists and the caller is authorised for its budget.
    function _agreementFor(uint256 id) private view returns (Agreement storage a) {
        a = _agreements[id];
        if (a.safe == address(0)) revert InvalidAgreement();
        _requireAuthorised(a.budgetId);
    }

    function _acceptedFor(uint256 id) private view returns (Agreement storage a) {
        a = _agreementFor(id);
        if (!a.accepted) revert NotAccepted();
    }

    /// @dev Bring every open agreement of a budget up to date, freeing the reservation of those past their
    /// end, lowering date or offer expiry, and drop closed ones from the open list (beta `_settleDepartment`).
    function _settle(uint256 budgetId) private {
        uint256[] storage open = _open[budgetId];
        uint256 i;
        while (i < open.length) {
            Agreement storage a = _agreements[open[i]];
            // Only an end, a lowering or an expiry that is due changes the reservation; skip the accrual
            // write for the rest, which keeps settling cheap.
            if (
                (a.endsAt != 0 && block.timestamp >= a.endsAt) || (a.pendingAt != 0 && block.timestamp >= a.pendingAt)
                    || (!a.accepted && block.timestamp >= a.offerExpiresAt)
            ) {
                _accrue(open[i], uint64(block.timestamp));
            }
            if (a.closed) {
                open[i] = open[open.length - 1];
                open.pop();
            } else {
                ++i;
            }
        }
    }

    /// @dev Accrue to `t` (capped at the end date), apply a due lowering, and close the agreement once the
    /// end date has passed. An offer accrues nothing, and closes once it expires.
    function _accrue(uint256 id, uint64 t) private {
        Agreement storage a = _agreements[id];
        if (a.closed) return;
        if (!a.accepted) {
            if (t >= a.offerExpiresAt) _close(id, a);
            return;
        }
        uint64 stop = a.endsAt != 0 && a.endsAt < t ? a.endsAt : t;
        if (a.pendingAt != 0 && a.pendingAt <= stop) {
            _accrueTo(a, a.pendingAt);
            uint128 freed = _figure(a, a.rate) - _figure(a, a.pendingRate);
            a.reserved -= freed;
            IBudgets(budgets).release(a.budgetId, freed);
            emit ReservationReleased(a.safe, a.budgetId, id, freed);
            a.rate = a.pendingRate;
            a.pendingAt = 0;
            a.pendingRate = 0;
        }
        _accrueTo(a, stop);
        if (a.endsAt != 0 && t >= a.endsAt) _close(id, a);
    }

    /// @dev An offer's events, read back from storage so `offer` keeps a shallow stack.
    function _emitOffered(uint256 id, Agreement storage a) private {
        emit AgreementOffered(
            a.safe,
            a.budgetId,
            id,
            a.token,
            a.payee,
            a.rate,
            a.period,
            a.startsAt,
            a.step,
            a.offerExpiresAt,
            a.documentHash
        );
        if (a.endsAt != 0) emit AgreementEnded(a.safe, id, a.endsAt);
    }

    /// @dev Free the reservation and release all earned pay.
    function _close(uint256 id, Agreement storage a) private {
        a.closed = true;
        a.releasedScaled = a.earnedScaled;
        IBudgets(budgets).release(a.budgetId, a.reserved);
        emit ReservationReleased(a.safe, a.budgetId, id, a.reserved);
    }

    function _accrueTo(Agreement storage a, uint64 t) private {
        if (t <= a.accruedAt) return;
        (a.earnedScaled, a.releasedScaled) = _segment(
            a.earnedScaled, a.releasedScaled, a.accruedAt, t, a.paused ? 0 : a.rate, a.period, a.startsAt, a.step
        );
        a.accruedAt = t;
    }

    /// @dev What `_accrue` would store at `t`, without writing it.
    function _project(Agreement memory a, uint64 t) private pure returns (uint256 earned, uint256 released) {
        earned = a.earnedScaled;
        released = a.releasedScaled;
        if (a.closed || !a.accepted) return (earned, released);
        uint64 stop = a.endsAt != 0 && a.endsAt < t ? a.endsAt : t;
        uint64 from = a.accruedAt;
        uint256 rate = a.paused ? 0 : a.rate;
        if (a.pendingAt != 0 && a.pendingAt <= stop) {
            if (a.pendingAt > from) {
                (earned, released) = _segment(earned, released, from, a.pendingAt, rate, a.period, a.startsAt, a.step);
                from = a.pendingAt;
            }
            rate = a.paused ? 0 : a.pendingRate;
        }
        (earned, released) = _segment(earned, released, from, stop, rate, a.period, a.startsAt, a.step);
        if (a.endsAt != 0 && t >= a.endsAt) released = earned;
    }

    /// @dev Accrue from `from` to `to` at one rate, by the calendar. The released part is what was earned by
    /// the last whole step from the start date (or the last month start, for `MONTHLY`), at or before `to`.
    /// `from` is never before the start date, because the checkpoint starts there.
    function _segment(
        uint256 earned,
        uint256 released,
        uint64 from,
        uint64 to,
        uint256 rate,
        uint8 period,
        uint64 startsAt,
        uint64 step
    )
        private
        pure
        returns (uint256, uint256)
    {
        if (to <= from) return (earned, released);
        uint256 boundary = step == MONTHLY ? Calendar.monthStart(to) : startsAt + uint256(to - startsAt) / step * step;
        if (rate == 0) return (earned, boundary > from ? earned : released);
        uint256 n = Calendar.numerator(rate, period);
        uint256 start = Calendar.clock(period, from);
        uint256 finish = Calendar.clock(period, to);
        if (boundary > from) {
            released = earned + n * ((boundary == to ? finish : Calendar.clock(period, boundary)) - start);
        }
        return (earned + n * (finish - start), released);
    }

    function _available(uint256 scaled, uint128 collected) private pure returns (uint128) {
        return uint128(scaled / ICalendar.SCALE) - collected;
    }

    /// @dev A rate's reservation figure in the agreement's budget (its period read from Budgets).
    function _figure(Agreement storage a, uint128 rate) private view returns (uint128) {
        return _toUint128(Calendar.periodFigure(rate, a.period, IBudgets(budgets).budgetOf(a.budgetId).period));
    }

    /// @dev `InvalidRate` if a figure does not fit the budget's units.
    function _toUint128(uint256 figure) private pure returns (uint128) {
        if (figure > type(uint128).max) revert InvalidRate();
        return uint128(figure);
    }
    // forge-lint: disable-end
}
