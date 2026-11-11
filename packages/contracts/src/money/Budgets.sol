// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { IBudgets } from "../interfaces/IBudgets.sol";
import { IPayments } from "../interfaces/IPayments.sol";
import { IHats } from "../interfaces/external/IHats.sol";
import { IHatsSignerGate } from "../interfaces/external/IHatsSignerGate.sol";
import { IRoles } from "../interfaces/external/IRoles.sol";
import { Calendar } from "../libraries/Calendar.sol";
import { PayoutBatch } from "../libraries/PayoutBatch.sol";

/// @title Budgets
/// @notice A company's money planned as a tree of budgets keyed by the company Safe
/// (docs/planning/protocol-v4/spec/budgets.md). The tree is ported from Firm's allowance tree; the payout
/// path is beta `PayrollDepartments.collect`, kept exactly.
contract Budgets is IBudgets {
    /// @dev Safe's MultiSendCallOnly 1.4.1, the same address on every chain; on the Gate's
    /// delegatecall allow-list (R3 Q4 point 4).
    address internal constant MULTI_SEND_CALL_ONLY = 0x9641d764fc13c8B624c04430C7356C1C7C8102e2;
    /// @dev Zodiac `Enum.Operation.DelegateCall`.
    uint8 internal constant DELEGATECALL = 1;
    /// @dev The payment kind of an agreement collection.
    uint16 internal constant KIND_COLLECTION = 4;
    /// @dev Kinds 0 to 3 are the ones a person prepares.
    uint16 internal constant MAX_PREPARED_KIND = 3;

    address internal immutable _payments;
    address internal immutable _hats;
    /// @dev Companies House: the only caller of `setAgreements`.
    address internal immutable _deployer;

    /// @inheritdoc IBudgets
    /// @dev A storage variable, not a function, so Certora confs can link it (`Budgets:agreements=...`).
    address public agreements;
    mapping(address safe => Config) internal _configs;
    mapping(uint256 id => Budget) internal _budgets;
    /// @dev Read by views only (R4 3.3).
    mapping(uint256 id => uint256[]) internal _children;
    mapping(uint256 id => Scheduled) internal _scheduled;
    uint256 internal _budgetCount;
    uint256 internal _scheduledCount;
    /// @dev D10: the one-slot reentrancy lock.
    bool internal _entered;

    /// @dev D10. Protocol-specific error, so OpenZeppelin's ReentrancyGuard is not used.
    modifier nonReentrant() {
        if (_entered) revert ReentrantCall();
        _entered = true;
        _;
        _entered = false;
    }

    modifier onlyAgreements() {
        if (msg.sender != agreements) revert OnlyAgreements();
        _;
    }

    /// @param payments_ The Payments contract.
    /// @param hats_ Hats Protocol.
    constructor(address payments_, address hats_) {
        if (payments_ == address(0) || hats_ == address(0)) revert ZeroAddress();
        _payments = payments_;
        _hats = hats_;
        _deployer = msg.sender;
    }

    // ------------------------------------------------------------------ Wiring

    /// @inheritdoc IBudgets
    function MAX_DEPTH() public pure returns (uint8) {
        return 8;
    }

    /// @inheritdoc IBudgets
    function payments() external view returns (address) {
        return _payments;
    }

    /// @inheritdoc IBudgets
    function hats() external view returns (address) {
        return _hats;
    }

    /// @inheritdoc IBudgets
    function setAgreements(address agreements_) external nonReentrant {
        if (msg.sender != _deployer) revert NotDeployer();
        if (agreements != address(0)) revert AlreadySet();
        if (agreements_ == address(0)) revert ZeroAddress();
        agreements = agreements_;
        emit AgreementsSet(agreements_);
    }

    /// @inheritdoc IBudgets
    function configs(address safe) external view returns (address, bytes32) {
        Config storage c = _configs[safe];
        return (c.roles, c.payoutRoleKey);
    }

    /// @inheritdoc IBudgets
    function budgetCount() external view returns (uint256) {
        return _budgetCount;
    }

    /// @inheritdoc IBudgets
    function scheduledCount() external view returns (uint256) {
        return _scheduledCount;
    }

    // ------------------------------------------------------------------ The Safe

    /// @inheritdoc IBudgets
    function configure(address roles, bytes32 payoutRoleKey) external nonReentrant {
        // D1: Roles sits on the Gate (avatar = Safe, target = the Gate whose Safe is the caller).
        if (_readAddress(roles, IRoles.avatar.selector) != msg.sender) revert InvalidConfiguration();
        address gate = _readAddress(roles, IRoles.target.selector);
        if (gate == msg.sender || _readAddress(gate, IHatsSignerGate.safe.selector) != msg.sender) {
            revert InvalidConfiguration();
        }
        _configs[msg.sender] = Config(roles, payoutRoleKey);
        emit Configured(msg.sender, roles, payoutRoleKey);
    }

    /// @inheritdoc IBudgets
    function createTopBudget(
        address token,
        uint8 period,
        uint128 amount,
        uint256 hat
    )
        external
        nonReentrant
        returns (uint256 id)
    {
        if (_configs[msg.sender].roles == address(0)) revert NotConfigured();
        if (token == address(0) || token.code.length == 0) revert InvalidToken();
        uint64 index = _index(period); // reverts ICalendar.InvalidBudgetPeriod
        if (hat == 0) revert InvalidHat();
        id = _create(msg.sender, 0, hat, token, period, 1, amount, index);
    }

    // ------------------------------------------------------------------ Hat wearers

    /// @inheritdoc IBudgets
    function createChildBudget(uint256 parent, uint128 amount, uint256 hat) external nonReentrant returns (uint256 id) {
        Budget storage p = _get(parent);
        _requireAuthorised(parent, msg.sender);
        _walk(parent, true);
        if (p.depth >= MAX_DEPTH()) revert TooDeep();
        if (hat == 0) revert InvalidHat();
        _requireRoom(parent, p, amount);
        p.childrenAmount += amount;
        id = _create(p.safe, parent, hat, p.token, p.period, p.depth + 1, amount, p.periodIndex);
        _children[parent].push(id);
    }

    /// @inheritdoc IBudgets
    function setAmount(uint256 id, uint128 amount) external nonReentrant {
        Budget storage b = _get(id);
        _requireManager(id, b);
        _walk(id, false);
        uint256 used = uint256(b.ownSpent) + b.ownCommitted + b.childrenAmount;
        if (amount < used) revert AmountBelowUse(id, SafeCast.toUint128(used), amount);
        if (b.parent != 0) {
            Budget storage p = _budgets[b.parent];
            if (amount > b.amount) {
                _requireRoom(b.parent, p, amount - b.amount);
                p.childrenAmount += amount - b.amount;
            } else {
                p.childrenAmount -= b.amount - amount;
            }
        }
        b.amount = amount;
        emit BudgetAmountSet(b.safe, id, amount);
    }

    /// @inheritdoc IBudgets
    function setHat(uint256 id, uint256 hat) external nonReentrant {
        Budget storage b = _get(id);
        _requireManager(id, b);
        if (hat == 0) revert InvalidHat();
        b.hat = hat;
        emit BudgetHatSet(b.safe, id, hat);
    }

    /// @inheritdoc IBudgets
    function close(uint256 id) external nonReentrant {
        Budget storage b = _get(id);
        _requireManager(id, b);
        if (b.closed) revert AlreadyClosed();
        b.closed = true;
        emit BudgetClosed(b.safe, id);
    }

    /// @inheritdoc IBudgets
    function reopen(uint256 id) external nonReentrant {
        Budget storage b = _get(id);
        _requireManager(id, b);
        if (!b.closed) revert NotClosed();
        b.closed = false;
        emit BudgetReopened(b.safe, id);
    }

    /// @inheritdoc IBudgets
    function spend(
        uint256 id,
        address recipient,
        uint128 amount,
        uint16 kind,
        bytes32 documentHash,
        bytes32 jobNonce
    )
        external
        nonReentrant
        returns (bytes32 paymentId)
    {
        Budget storage b = _get(id);
        _requireAuthorised(id, msg.sender);
        _walk(id, true);
        if (amount == 0) revert ZeroAmount();
        _requireKind(kind);
        if (documentHash == 0) revert ZeroDocumentHash();
        if (jobNonce == 0) revert ZeroJobNonce();
        uint128 left = _left(b);
        if (amount > left) revert OverBudget(id, left, amount);
        b.ownSpent += amount;
        _up(id, amount, 0, 0);
        paymentId = _pay(b, recipient, amount, kind, documentHash, keccak256(abi.encode(address(this), id, jobNonce)));
        // forge-lint: disable-next-line(reentrancy-events)
        emit Spent(b.safe, id, recipient, amount, kind, documentHash, paymentId);
    }

    /// @inheritdoc IBudgets
    function schedule(
        uint256 id,
        address to,
        uint128 amount,
        uint16 kind,
        uint64 payAt,
        bytes32 documentHash,
        bytes32 jobNonce
    )
        external
        nonReentrant
        returns (uint256 scheduledId)
    {
        Budget storage b = _get(id);
        _requireAuthorised(id, msg.sender);
        _walk(id, true);
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        _requireKind(kind);
        if (documentHash == 0) revert ZeroDocumentHash();
        if (jobNonce == 0) revert ZeroJobNonce();
        // forge-lint: disable-next-line(block-timestamp)
        if (payAt <= block.timestamp) revert InvalidPayAt();
        uint128 left = _left(b);
        if (amount > left) revert OverBudget(id, left, amount);
        b.ownCommitted += amount;
        _up(id, 0, amount, 0);
        scheduledId = ++_scheduledCount;
        _scheduled[scheduledId] = Scheduled(id, to, amount, payAt, kind, ScheduleState.Pending, documentHash, jobNonce);
        emit PaymentScheduled(b.safe, id, scheduledId, to, amount, kind, payAt, documentHash, jobNonce);
    }

    /// @inheritdoc IBudgets
    function cancel(uint256 scheduledId) external nonReentrant {
        Scheduled storage s = _scheduled[scheduledId];
        if (s.state == ScheduleState.None) revert UnknownScheduled(scheduledId);
        _requireAuthorised(s.budgetId, msg.sender);
        if (s.state != ScheduleState.Pending) revert NotPending(scheduledId);
        _walk(s.budgetId, false);
        s.state = ScheduleState.Cancelled;
        _budgets[s.budgetId].ownCommitted -= s.amount;
        _up(s.budgetId, 0, 0, s.amount);
        emit ScheduleCancelled(_budgets[s.budgetId].safe, s.budgetId, scheduledId);
    }

    // ------------------------------------------------------------------ Anyone

    /// @inheritdoc IBudgets
    function execute(uint256 scheduledId) external nonReentrant returns (bytes32 paymentId) {
        Scheduled storage s = _scheduled[scheduledId];
        if (s.state == ScheduleState.None) revert UnknownScheduled(scheduledId);
        if (s.state != ScheduleState.Pending) revert NotPending(scheduledId);
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < s.payAt) revert NotDue(scheduledId, s.payAt);
        Budget storage b = _budgets[s.budgetId];
        _walk(s.budgetId, false);
        s.state = ScheduleState.Paid;
        b.ownCommitted -= s.amount;
        b.ownSpent += s.amount;
        _up(s.budgetId, s.amount, 0, s.amount);
        paymentId = _pay(
            b, s.to, s.amount, s.kind, s.documentHash, keccak256(abi.encode(address(this), s.budgetId, s.jobNonce))
        );
        // forge-lint: disable-next-line(reentrancy-events)
        emit ScheduledPaid(b.safe, s.budgetId, scheduledId, paymentId);
    }

    // ------------------------------------------------------------------ Agreements only

    /// @inheritdoc IBudgets
    function commit(uint256 id, uint128 amount) external nonReentrant onlyAgreements {
        Budget storage b = _get(id);
        _walk(id, true);
        uint128 left = _left(b);
        if (amount > left) revert OverBudget(id, left, amount);
        b.ownCommitted += amount;
        _up(id, 0, amount, 0);
        emit Committed(b.safe, id, amount);
    }

    /// @inheritdoc IBudgets
    function release(uint256 id, uint128 amount) external nonReentrant onlyAgreements {
        Budget storage b = _get(id);
        _walk(id, false);
        b.ownCommitted -= amount;
        _up(id, 0, 0, amount);
        emit Released(b.safe, id, amount);
    }

    /// @inheritdoc IBudgets
    function payReserved(
        uint256 id,
        address recipient,
        uint128 amount,
        bytes32 documentHash,
        bytes32 jobNonce
    )
        external
        nonReentrant
        onlyAgreements
        returns (bytes32 paymentId)
    {
        Budget storage b = _get(id);
        paymentId = _pay(b, recipient, amount, KIND_COLLECTION, documentHash, jobNonce);
        // forge-lint: disable-next-line(reentrancy-events)
        emit ReservedPaid(b.safe, id, recipient, amount, paymentId);
    }

    // ------------------------------------------------------------------ Views

    /// @inheritdoc IBudgets
    function budgetOf(uint256 id) external view returns (Budget memory b) {
        b = _budgets[id];
        if (b.safe == address(0)) return b;
        uint64 index = _index(b.period);
        // forge-lint: disable-next-line(block-timestamp)
        if (b.periodIndex != index) {
            b.ownSpent = 0;
            b.spent = 0;
            b.periodIndex = index;
        }
    }

    /// @inheritdoc IBudgets
    function leftOf(uint256 id) external view returns (uint128) {
        Budget storage b = _budgets[id];
        if (b.safe == address(0)) return 0;
        // forge-lint: disable-next-line(block-timestamp)
        uint128 ownSpent = b.periodIndex == _index(b.period) ? b.ownSpent : 0;
        return b.amount - b.childrenAmount - ownSpent - b.ownCommitted;
    }

    /// @inheritdoc IBudgets
    function childrenOf(uint256 id) external view returns (uint256[] memory) {
        return _children[id];
    }

    /// @inheritdoc IBudgets
    function authorised(uint256 id, address who) public view returns (bool) {
        for (uint256 i; i < MAX_DEPTH(); ++i) {
            Budget storage b = _budgets[id];
            if (b.safe == address(0)) return false;
            if (b.safe == who) return true;
            // forge-lint: disable-next-line(calls-loop)
            if (IHats(_hats).isWearerOfHat(who, b.hat) && IHats(_hats).isInGoodStanding(who, b.hat)) return true;
            id = b.parent;
        }
        return false;
    }

    /// @inheritdoc IBudgets
    function pathOf(uint256 id) external view returns (uint256[] memory path) {
        path = new uint256[](_budgets[id].depth);
        for (uint256 i = path.length; i > 0; --i) {
            path[i - 1] = id;
            id = _budgets[id].parent;
        }
    }

    /// @inheritdoc IBudgets
    function scheduledOf(uint256 id) external view returns (Scheduled memory) {
        return _scheduled[id];
    }

    // ------------------------------------------------------------------ Internals

    function _get(uint256 id) private view returns (Budget storage b) {
        b = _budgets[id];
        if (b.safe == address(0)) revert UnknownBudget(id);
    }

    function _index(uint8 period) private view returns (uint64) {
        return SafeCast.toUint64(Calendar.periodIndex(period, block.timestamp));
    }

    function _create(
        address safe,
        uint256 parent,
        uint256 hat,
        address token,
        uint8 period,
        uint8 depth,
        uint128 amount,
        uint64 index
    )
        private
        returns (uint256 id)
    {
        id = ++_budgetCount;
        Budget storage b = _budgets[id];
        b.safe = safe;
        b.parent = parent;
        b.hat = hat;
        b.token = token;
        b.period = period;
        b.depth = depth;
        b.amount = amount;
        b.periodIndex = index;
        emit BudgetCreated(safe, id, parent, token, period, amount, hat);
    }

    function _requireAuthorised(uint256 id, address who) private view {
        if (!authorised(id, who)) revert NotAuthorised(id, who);
    }

    /// @dev Who may set, close or reopen a budget: top budget the Safe, a child whoever is authorised for
    /// its parent.
    function _requireManager(uint256 id, Budget storage b) private view {
        if (b.parent == 0 ? msg.sender != b.safe : !authorised(b.parent, msg.sender)) {
            revert NotAuthorised(id, msg.sender);
        }
    }

    function _requireKind(uint16 kind) private pure {
        if (kind > MAX_PREPARED_KIND) revert InvalidKind(kind);
    }

    /// @dev A budget's own room, over effective values: call after the path was rolled.
    function _left(Budget storage b) private view returns (uint128) {
        return b.amount - b.childrenAmount - b.ownSpent - b.ownCommitted;
    }

    /// @dev `amount` fits in `p` as one more child amount (B6): call after the path was rolled.
    function _requireRoom(uint256 parent, Budget storage p, uint128 amount) private view {
        uint128 left = _left(p);
        if (amount > left) revert ChildrenExceedParent(parent, left, amount);
    }

    /// @dev Rolls every budget on the path whose period turned (N-9) and, when `requireOpen`, reverts
    /// naming the nearest closed budget (B3). Constant-bound loop (R4 3.3).
    function _walk(uint256 id, bool requireOpen) private {
        for (uint256 i; i < MAX_DEPTH(); ++i) {
            if (id == 0) break;
            Budget storage b = _budgets[id];
            uint64 index = _index(b.period);
            // forge-lint: disable-next-line(block-timestamp)
            if (b.periodIndex != index) {
                b.ownSpent = 0;
                b.spent = 0;
                b.periodIndex = index;
            }
            // forge-lint: disable-next-line(require-revert-in-loop)
            if (requireOpen && b.closed) revert BudgetIsClosed(id);
            id = b.parent;
        }
    }

    /// @dev Moves the sums on `id` and every ancestor (B2): `spent` up by `spentAdd`, `committed` up by
    /// `committedAdd` then down by `committedSub`. Call after `_walk`.
    function _up(uint256 id, uint128 spentAdd, uint128 committedAdd, uint128 committedSub) private {
        for (uint256 i; i < MAX_DEPTH(); ++i) {
            if (id == 0) break;
            Budget storage b = _budgets[id];
            b.spent += spentAdd;
            b.committed = b.committed + committedAdd - committedSub;
            id = b.parent;
        }
    }

    /// @dev One Roles call: MultiSendCallOnly batching `approve(payments, amount)` and `send(item)` with the
    /// Safe as executor, `shouldRevert = true` (spec "Paying"). Roles refusing or the token failing reverts
    /// the whole call.
    function _pay(
        Budget storage b,
        address recipient,
        uint128 amount,
        uint16 kind,
        bytes32 documentHash,
        bytes32 jobNonce
    )
        private
        returns (bytes32)
    {
        IPayments.PaymentItem memory item;
        item.recipient = recipient;
        item.token = b.token;
        item.amount = amount;
        item.kind = kind;
        item.documentHash = documentHash;
        item.jobNonce = jobNonce;
        item.executor = b.safe;
        item.paymentId = IPayments(_payments).paymentId(item);
        Config storage c = _configs[b.safe];
        // forge-lint: disable-start(reentrancy-no-eth, unused-return)
        IRoles(c.roles)
            .execTransactionWithRole(
                MULTI_SEND_CALL_ONLY, 0, PayoutBatch.multiSend(_payments, item), DELEGATECALL, c.payoutRoleKey, true
            );
        // forge-lint: disable-end(reentrancy-no-eth, unused-return)
        return item.paymentId;
    }

    /// @dev A static read of one address word; any failure, wrong length or dirty upper bits is
    /// `InvalidConfiguration`.
    function _readAddress(address target, bytes4 selector) private view returns (address) {
        (bool ok, bytes memory data) = target.staticcall(abi.encodeWithSelector(selector));
        if (!ok || data.length != 32) revert InvalidConfiguration();
        uint256 word = abi.decode(data, (uint256));
        if (word > type(uint160).max) revert InvalidConfiguration();
        // forge-lint: disable-next-line(unsafe-typecast)
        return address(uint160(word));
    }
}
