// VENDORED VERBATIM from packages/contracts/src (beta, frozen) as the reference for the differential fuzz test.
// The only change: `_segment`'s local `end` is renamed `stop`, so the file compiles without a shadowing warning (J14).
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { CapxulPaymentsV3 } from "./CapxulPaymentsV3.sol";
import { PayrollCalendar } from "./PayrollCalendar.sol";

/// @dev The part of Zodiac Roles v2.1 that the contract calls.
interface IRolesModifier {
    function avatar() external view returns (address);
    function target() external view returns (address);
    function execTransactionWithRole(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        bytes32 roleKey,
        bool shouldRevert
    )
        external
        returns (bool success);
}

/// @dev Safe's MultiSendCallOnly v1.4.1.
interface IMultiSend {
    function multiSend(bytes memory transactions) external payable;
}

/// @title PayrollDepartments
/// @notice Every Organization's departments: each one a payroll budget and the
/// bucket of payment agreements its holders have made from it.
/// @dev One shared contract serves every Organization, keyed by its Safe. A
/// department is identified by a `bytes32` id the Organization chooses, and
/// exists once the Owners give it a budget. A department keeps one budget per
/// token (CAP-1012): each caps the yearly amount of every agreement running or
/// offered in the department in that token, and no token counts against
/// another. Each agreement names its token when it is offered and keeps it.
///
/// The contract keeps no list of holders. Every change to a department arrives
/// from the Organization's Safe, either signed by the Owners or sent by a holder
/// through the department's Zodiac Roles role. That role is scoped to this
/// contract's holder functions with the first argument, the department id,
/// fixed to its own department. So Roles decides who may act for which
/// department, and this contract keeps the budget and the agreements, as a
/// spending Budget is a Roles role plus an allowance. Any holder can act alone;
/// a holder that is itself a Safe gives a department a threshold of its own.
///
/// The contract pays through a second role on the same Roles modifier, the
/// payout role, whose only member is this contract. That role may only approve
/// the payment router and call `CapxulPaymentsV3.send` in the tokens the Owners
/// enabled, each within its own Roles allowance that the Owners size. So Roles
/// bounds how much of each token can ever leave through the contract, whatever
/// the contract's own checks say.
///
/// Every agreement is offered, then accepted by the payee's Safe against the
/// exact terms (their document hash) before the offer expires. An agreement
/// keeps its rate as written, an amount per week, month or year, and pays it
/// exactly by the UTC calendar (`PayrollCalendar`, CAP-989): a weekly amount
/// over each 7 days, and a monthly amount (a yearly rate ÷ 12) over each
/// calendar month's own seconds. The offer reserves the rate's yearly figure in
/// the department's budget at once, or, for a fixed term that pays less, only
/// what the term will pay (D4, CAP-901).
/// Pay accrues every second from the later of the start date and the
/// acceptance. The release step sets how much of it the payee can collect: only
/// whole steps from the accrual start are released. A step of one second is a
/// stream; one day is daily early access; seven days a weekly retainer; and
/// `MONTHLY` releases each calendar month's pay at 00:00 UTC on the 1st.
///
/// Implements the ADR-0040 departments amendment. Not audited.
contract PayrollDepartments {
    /// @notice The release step that releases pay at each calendar month's start,
    /// 00:00 UTC on the 1st, instead of a fixed number of seconds.
    uint64 public constant MONTHLY = type(uint64).max;

    /// @notice A rate's period: its amount is paid per week, per calendar month,
    /// or per year of 12 calendar months.
    uint8 public constant PER_WEEK = PayrollCalendar.WEEK;
    uint8 public constant PER_MONTH = PayrollCalendar.MONTH_PERIOD;
    uint8 public constant PER_YEAR = PayrollCalendar.YEAR;

    /// @notice Bound on a department's running agreements and offers, so settling
    /// the budget stays cheap.
    uint256 public constant MAX_OPEN_AGREEMENTS = 64;

    /// @notice The `kind` stamp of every collection. It marks a payment from a
    /// payment agreement. The protocol package reserves the same value.
    uint16 public constant PAYMENT_KIND = 4;

    /// @notice Safe's MultiSendCallOnly v1.4.1, at the same address on every
    /// chain. Each Organization's Roles modifier has the Zodiac MultiSend
    /// unwrapper set for it, as for a Budget spend.
    address public constant MULTI_SEND_CALL_ONLY = 0x9641d764fc13c8B624c04430C7356C1C7C8102e2;

    /// @dev Roles and MultiSend `Enum.Operation` values.
    uint8 private constant CALL = 0;
    uint8 private constant DELEGATECALL = 1;

    struct Config {
        address roles;
        bytes32 payoutRoleKey;
        address router; // CapxulPaymentsV3
    }

    struct Department {
        uint128 budget; // yearly, in units of its token; 0 means closed to new commitments
        uint128 committed; // sum of the reservations (yearly figures) of running agreements and standing offers
    }

    struct Agreement {
        address safe;
        bytes32 department;
        address token; // what the agreement budgets and pays in; fixed for its life
        address payee;
        uint128 rate; // as written: token units per `period`
        uint8 period; // PER_WEEK, PER_MONTH or PER_YEAR
        uint128 collected;
        uint128 reserved; // what counts against the budget: the rate's yearly figure, or less for a short fixed term
        uint256 earnedScaled; // pay accrued up to `accruedAt`, in `PayrollCalendar.SCALE` units, so no remainder is lost
        uint256 releasedScaled; // the part of `earnedScaled` earned by the last whole release step
        uint64 startsAt; // accrual start: the later of the start date and the acceptance
        uint64 step; // release step in seconds (1 releases every second), or MONTHLY
        uint64 offerExpiresAt; // the payee must accept before this time
        uint64 accruedAt; // accrual checkpoint; a future value is the start date
        uint64 endsAt; // exclusive end; 0 while open-ended
        uint64 pendingAt; // effective date of a lowering, 0 if none
        uint128 pendingRate; // in the agreement's period
        uint64 collections; // number of collections, so each payment has its own job nonce
        bool accepted; // the payee's Safe accepted the terms; nothing accrues before
        bool paused; // nothing accrues while paused
        bool closed; // ended, or an offer withdrawn or expired: budget freed and all earned pay released
        bytes32 documentHash; // hash of the agreement's terms document, stamped on each payment
    }

    mapping(address safe => Config) public configs;
    mapping(address safe => mapping(bytes32 department => mapping(address token => Department))) public departments;
    mapping(uint256 id => Agreement) private _agreements;
    mapping(address safe => mapping(bytes32 department => uint256[])) private _open;
    uint256 public agreementCount;

    event Configured(address indexed safe, address roles, bytes32 payoutRoleKey, address router);
    event BudgetSet(address indexed safe, bytes32 indexed department, address indexed token, uint128 budget);
    event AgreementOffered(
        address indexed safe,
        bytes32 indexed department,
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
    event BudgetReleased(
        address indexed safe, bytes32 indexed department, uint256 indexed id, address token, uint128 amount
    );
    event Collected(
        address indexed safe,
        uint256 indexed id,
        address indexed payee,
        address token,
        uint128 amount,
        bytes32 settlementId
    );

    error NotConfigured();
    error InvalidConfiguration();
    error NotTheSafe();
    error InvalidDepartment();
    error DepartmentClosed();
    error InvalidToken();
    error NotInDepartment();
    error NotThePayee();
    error OverBudget(uint128 budget, uint128 committed, uint128 requested);
    error TooManyAgreements();
    error InvalidAgreement();
    error InvalidDate();
    error InvalidRate();
    error InvalidPeriod();
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

    // ---------------------------------------------------------------- Owner

    /// @notice The Safe points the contract at its Roles modifier, the payout
    /// role and the payment router. Called by the Safe under its own threshold;
    /// no department role may call it. Which tokens the contract can pay in is
    /// the payout role's to say: one branch and one allowance per token.
    function configure(address roles, bytes32 payoutRoleKey, address router) external {
        if (IRolesModifier(roles).avatar() != msg.sender || IRolesModifier(roles).target() != msg.sender) {
            revert NotTheSafe();
        }
        if (router == address(0)) revert InvalidConfiguration();
        configs[msg.sender] = Config({ roles: roles, payoutRoleKey: payoutRoleKey, router: router });
        emit Configured(msg.sender, roles, payoutRoleKey, router);
    }

    /// @notice The Safe creates a department or changes its budget in one token.
    /// A department keeps a separate budget per token, and no token counts
    /// against another. A budget below what is committed ends nothing; it only
    /// refuses new commitments. A budget of 0 closes that token to new offers.
    /// No department role may call it.
    function setBudget(bytes32 department, address token, uint128 budget) external {
        _config(msg.sender);
        if (department == bytes32(0)) revert InvalidDepartment();
        if (token == address(0)) revert InvalidToken();
        departments[msg.sender][department][token].budget = budget;
        emit BudgetSet(msg.sender, department, token, budget);
    }

    // ---------------------------------------------------------- Agreements

    /// @notice Offer an agreement from a department's budget in `token`, which the
    /// agreement pays in for its whole life. `rate` is paid per
    /// `period`. The offer counts against the budget at once. `startsAt` 0 means
    /// now. `endsAt` 0 makes it open-ended; otherwise it is a fixed term that
    /// ends at `endsAt`, exclusive, and reserves only what it will pay if that is
    /// less than the rate's yearly figure. `step` is the release step in seconds,
    /// or `MONTHLY`. The payee must accept before `offerExpiresAt`, which may not
    /// fall after the end. `documentHash` is the hash of the terms document.
    function offer(
        bytes32 department,
        address token,
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
        returns (uint256 id)
    {
        _config(msg.sender);
        if (payee == address(0) || rate == 0 || documentHash == bytes32(0)) revert InvalidAgreement();
        if (period > PER_YEAR) revert InvalidPeriod();
        if (step == 0) revert InvalidStep();
        if (startsAt == 0) startsAt = uint64(block.timestamp);
        else if (startsAt < block.timestamp) revert InvalidDate();
        if (offerExpiresAt <= block.timestamp) revert InvalidDate();
        if (endsAt != 0 && (endsAt <= startsAt || offerExpiresAt > endsAt)) revert InvalidDate();

        id = ++agreementCount;
        Agreement storage a = _agreements[id];
        a.reserved = _reserve(department, token, reservation(rate, period, startsAt, endsAt));
        a.safe = msg.sender;
        a.department = department;
        a.token = token;
        a.payee = payee;
        a.rate = rate;
        a.period = period;
        a.startsAt = startsAt;
        a.step = step;
        a.offerExpiresAt = offerExpiresAt;
        a.accruedAt = startsAt;
        a.endsAt = endsAt;
        a.documentHash = documentHash;
        _open[msg.sender][department].push(id);
        _emitOffered(id, a);
    }

    /// @notice The payee's Safe accepts an offer. `termsHash` must equal the
    /// agreement's document hash, so the payee consents to the exact terms. Pay
    /// accrues from the later of the start date and now.
    function accept(uint256 id, bytes32 termsHash) external {
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

    /// @notice Withdraw an offer that the payee has not accepted. Its budget is
    /// freed at once.
    function withdrawOffer(bytes32 department, uint256 id) external {
        Agreement storage a = _agreementFor(department, id);
        if (a.accepted) revert AlreadyAccepted();
        _accrue(id, uint64(block.timestamp));
        if (a.closed) revert OfferExpired();
        _close(id, a);
        emit OfferWithdrawn(a.safe, id);
    }

    /// @notice Change an agreement's rate, in its own period. A raise takes effect
    /// now and counts only the difference of the yearly figures against the
    /// budget. A lowering frees budget at `effectiveAt`. An agreement with an end date, a fixed term included, keeps
    /// its rate: pay more as a separate payment, or end it and offer anew.
    function changeRate(bytes32 department, uint256 id, uint128 newRate, uint64 effectiveAt) external {
        Agreement storage a = _acceptedFor(department, id);
        // Accrue first: a lowering whose date has come takes effect, so the new
        // rate is compared with the rate the agreement pays now.
        _accrue(id, uint64(block.timestamp));
        if (newRate == 0 || newRate == a.rate) revert InvalidRate();
        if (a.endsAt != 0) revert AlreadyEnded();
        if (a.pendingAt != 0) revert PendingChange();
        if (newRate > a.rate) {
            Department storage d = departments[a.safe][department][a.token];
            _settleDepartment(a.safe, department);
            uint128 diff = _yearly(newRate, a.period) - _yearly(a.rate, a.period);
            _requireRoom(d, diff);
            d.committed += diff;
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

    /// @notice Cancel a lowering that waits for its date. The agreement keeps its
    /// rate, and its reservation does not change. A lowering whose date has
    /// come has taken effect and cannot be cancelled.
    function cancelChange(bytes32 department, uint256 id) external {
        Agreement storage a = _acceptedFor(department, id);
        _accrue(id, uint64(block.timestamp));
        if (a.closed) revert AlreadyEnded();
        if (a.pendingAt == 0) revert NoPendingChange();
        a.pendingAt = 0;
        a.pendingRate = 0;
        emit RateChangeCancelled(a.safe, id);
    }

    /// @notice Pause an agreement. Nothing accrues while it is paused. Earned
    /// pay stays collectable, and the budget does not change.
    function pause(bytes32 department, uint256 id) external {
        Agreement storage a = _acceptedFor(department, id);
        if (a.paused) revert AlreadyPaused();
        _accrue(id, uint64(block.timestamp));
        if (a.closed) revert AlreadyEnded();
        a.paused = true;
        emit AgreementPaused(a.safe, id);
    }

    /// @notice Resume a paused agreement. Pay accrues again from now.
    function resume(bytes32 department, uint256 id) external {
        Agreement storage a = _acceptedFor(department, id);
        if (!a.paused) revert NotPaused();
        _accrue(id, uint64(block.timestamp));
        if (a.closed) revert AlreadyEnded();
        a.paused = false;
        emit AgreementResumed(a.safe, id);
    }

    /// @notice End an agreement. Pay keeps accruing until `endsAt`, exclusive,
    /// earned pay stays collectable, and the whole reservation is freed at
    /// `endsAt`. An end date that is already set, by an earlier end or by a fixed
    /// term's offer, can only move earlier.
    function end(bytes32 department, uint256 id, uint64 endsAt) external {
        Agreement storage a = _acceptedFor(department, id);
        if (a.endsAt != 0 && endsAt >= a.endsAt) revert AlreadyEnded();
        if (endsAt < block.timestamp) revert InvalidDate();
        _accrue(id, uint64(block.timestamp));
        a.endsAt = endsAt;
        emit AgreementEnded(a.safe, id, endsAt);
        _accrue(id, uint64(block.timestamp));
    }

    // ---------------------------------------------------------------- Payee

    /// @notice Collect released pay. The Safe pays it as one
    /// `CapxulPaymentsV3.send` through the payout role, so Roles' allowance caps
    /// the total across all agreements, and each collection is a stamped Payment
    /// with its own settlement id. Only the payee can collect.
    function collect(uint256 id, uint128 amount) external {
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

        Config storage c = configs[a.safe];
        CapxulPaymentsV3.PaymentItem memory item = CapxulPaymentsV3.PaymentItem({
            settlementId: bytes32(0),
            recipient: a.payee,
            token: a.token,
            amount: amount,
            kind: PAYMENT_KIND,
            documentHash: a.documentHash,
            jobNonce: keccak256(abi.encode(address(this), id, index)),
            executor: a.safe
        });
        item.settlementId = CapxulPaymentsV3(c.router).paymentId(item);
        emit Collected(a.safe, id, a.payee, a.token, amount, item.settlementId);

        // As a Budget spend does, one Roles call runs `approve(router, amount)` and
        // `send(item)` through MultiSendCallOnly, which the Roles unwrapper checks
        // call by call. The router takes exactly the approved amount, so no
        // standing approval is left that another spend could reset or use.
        bytes memory approve = abi.encodeCall(IERC20.approve, (c.router, amount));
        bytes memory send = abi.encodeCall(CapxulPaymentsV3.send, (item));
        bytes memory batch = abi.encodePacked(
            CALL, a.token, uint256(0), approve.length, approve, CALL, c.router, uint256(0), send.length, send
        );
        IRolesModifier(c.roles)
            .execTransactionWithRole(
                MULTI_SEND_CALL_ONLY,
                0,
                abi.encodeCall(IMultiSend.multiSend, (batch)),
                DELEGATECALL,
                c.payoutRoleKey,
                true
            );
    }

    // ---------------------------------------------------------------- Views

    /// @notice One agreement's stored terms and checkpoint.
    function agreementOf(uint256 id) external view returns (Agreement memory) {
        return _agreements[id];
    }

    /// @notice A department's budget in one token and the commitment that counts
    /// against it now.
    function budgetOf(
        address safe,
        bytes32 department,
        address token
    )
        external
        view
        returns (uint128 budget, uint128 committed)
    {
        Department storage d = departments[safe][department][token];
        committed = d.committed;
        uint256[] storage open = _open[safe][department];
        for (uint256 i; i < open.length; ++i) {
            Agreement storage a = _agreements[open[i]];
            if (a.closed || a.token != token) continue; // closed ones are already taken off `committed`
            if (!a.accepted) {
                if (block.timestamp >= a.offerExpiresAt) committed -= a.reserved;
            } else if (a.endsAt != 0 && block.timestamp >= a.endsAt) {
                committed -= a.reserved;
            } else if (a.pendingAt != 0 && block.timestamp >= a.pendingAt) {
                committed -= _yearly(a.rate, a.period) - _yearly(a.pendingRate, a.period);
            }
        }
        return (d.budget, committed);
    }

    /// @notice What an agreement reserves in its department's budget (D3, D4,
    /// CAP-901): the rate's yearly figure (a year's amount, 12 months, or 53
    /// weeks), or for a fixed term that pays less, its exact calendar pay from
    /// `startsAt` to `endsAt`, rounded down. Pay over the term rounds down the
    /// same way, so it never exceeds the reservation. `endsAt` 0 is open-ended.
    function reservation(uint128 rate, uint8 period, uint64 startsAt, uint64 endsAt) public pure returns (uint128) {
        uint128 yearly = _yearly(rate, period);
        if (endsAt == 0 || endsAt <= startsAt) return yearly;
        uint256 term = PayrollCalendar.earned(rate, period, startsAt, endsAt) / PayrollCalendar.SCALE;
        return term < yearly ? uint128(term) : yearly;
    }

    /// @notice Pay released and not yet collected, as of now.
    function availableOf(uint256 id) external view returns (uint128) {
        Agreement memory a = _agreements[id];
        (, uint256 released) = _project(a, uint64(block.timestamp));
        return _available(released, a.collected);
    }

    /// @notice Pay earned and not yet collected, as of now, released or not.
    function earnedOf(uint256 id) external view returns (uint128) {
        Agreement memory a = _agreements[id];
        (uint256 earned,) = _project(a, uint64(block.timestamp));
        return _available(earned, a.collected);
    }

    // ------------------------------------------------------------- Internal

    function _config(address safe) private view returns (Config storage c) {
        c = configs[safe];
        if (c.roles == address(0)) revert NotConfigured();
    }

    /// @dev An agreement of the calling Safe in `department`. Roles fixed the
    /// department for a holder; this ties the agreement to it.
    function _agreementFor(bytes32 department, uint256 id) private view returns (Agreement storage a) {
        a = _agreements[id];
        if (a.safe == address(0)) revert InvalidAgreement();
        if (msg.sender != a.safe || department != a.department) revert NotInDepartment();
    }

    /// @dev An agreement the payee has accepted, in the calling Safe's `department`.
    function _acceptedFor(bytes32 department, uint256 id) private view returns (Agreement storage a) {
        a = _agreementFor(department, id);
        if (!a.accepted) revert NotAccepted();
    }

    function _requireRoom(Department storage d, uint128 requested) private view {
        if (uint256(d.committed) + requested > d.budget) revert OverBudget(d.budget, d.committed, requested);
    }

    /// @dev Count a new offer's reservation against the calling Safe's budget for
    /// `department` in `token`, after freeing what is due. A token whose budget
    /// is 0, or one the Owners never budgeted, is closed to offers.
    function _reserve(bytes32 department, address token, uint128 reserved) private returns (uint128) {
        Department storage d = departments[msg.sender][department][token];
        if (d.budget == 0) revert DepartmentClosed();
        _settleDepartment(msg.sender, department);
        _requireRoom(d, reserved);
        if (_open[msg.sender][department].length >= MAX_OPEN_AGREEMENTS) revert TooManyAgreements();
        d.committed += reserved;
        return reserved;
    }

    /// @dev Bring every running agreement of a department up to date, freeing the
    /// budget of those past their end or lowering date.
    function _settleDepartment(address safe, bytes32 department) private {
        uint256[] storage open = _open[safe][department];
        uint256 i;
        while (i < open.length) {
            Agreement storage a = _agreements[open[i]];
            // Only an end or a lowering that is due changes the commitment; skip
            // the accrual write for the rest, which keeps settling cheap.
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

    /// @dev Accrue to `t` (capped at the end date), apply a due lowering, and
    /// close the agreement once the end date has passed. An offer accrues
    /// nothing, and closes once it expires.
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
            uint128 freed = _yearly(a.rate, a.period) - _yearly(a.pendingRate, a.period);
            departments[a.safe][a.department][a.token].committed -= freed;
            a.reserved -= freed;
            emit BudgetReleased(a.safe, a.department, id, a.token, freed);
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
            a.department,
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
        departments[a.safe][a.department][a.token].committed -= a.reserved;
        emit BudgetReleased(a.safe, a.department, id, a.token, a.reserved);
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

    /// @dev Accrue from `from` to `to` at one rate, by the calendar. The released
    /// part is what was earned by the last whole step from the start date (or the
    /// last month start, for `MONTHLY`), at or before `to`. `from` is never
    /// before the start date, because the checkpoint starts there.
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
        uint256 boundary =
            step == MONTHLY ? PayrollCalendar.monthStart(to) : startsAt + uint256(to - startsAt) / step * step;
        if (rate == 0) return (earned, boundary > from ? earned : released);
        uint256 n = PayrollCalendar.numerator(rate, period);
        uint256 start = PayrollCalendar.clock(period, from);
        uint256 stop = PayrollCalendar.clock(period, to);
        if (boundary > from) {
            released = earned + n * ((boundary == to ? stop : PayrollCalendar.clock(period, boundary)) - start);
        }
        return (earned + n * (stop - start), released);
    }

    function _available(uint256 scaled, uint128 collected) private pure returns (uint128) {
        return uint128(scaled / PayrollCalendar.SCALE) - collected;
    }

    /// @dev A rate's yearly figure, for budgets and reservations; InvalidRate if
    /// it does not fit the budget's units.
    function _yearly(uint128 rate, uint8 period) private pure returns (uint128) {
        uint256 yearly = PayrollCalendar.yearly(rate, period);
        if (yearly > type(uint128).max) revert InvalidRate();
        return uint128(yearly);
    }
}
