// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";

import { IBudgets } from "../../../src/interfaces/IBudgets.sol";
import { MockERC20 } from "../../mocks/MockERC20.sol";
import { MockReentrantERC20 } from "../../mocks/MockReentrantERC20.sol";
import { BudgetsCalendar } from "../../utils/Budgets/BudgetsCalendar.sol";

/// @notice Drives company A's budget trees through every Budgets entry point with bounded, valid
/// inputs (so `fail_on_revert` holds against a correct Budgets), and keeps the ghosts the invariants
/// compare against: own spend per budget per period (B11), pending scheduled amounts and agreement
/// reservations per budget (B15), and every re-entry the hostile token tried (B16).
/// @dev Actors: the company Safe (the Board), Amira (CEO hat), Jordan (Ops hat), Ben (Marketing
/// hat), anyone (execute), Agreements, and the re-entrant token. Trees grow to depth 8 over two
/// tokens on year, quarter and month periods. Everything is set up on the first call, so against
/// the stub each run fails on its first call with `NotImplemented()`.
contract BudgetsHandler is Test {
    struct Pending {
        uint256 sid;
        uint256 id;
        uint128 amount;
        uint64 payAt;
    }

    struct Wiring {
        IBudgets budgets;
        address deployer;
        address safe;
        address roles;
        bytes32 roleKey;
        address agreements;
        address usdc;
        address dai;
        address reentrant;
        address anyone;
        // Company B: a second Safe on the same Budgets, which nothing here may change (B7).
        address safeB;
        address rolesB;
        uint256 boardHatB;
        uint256 hatB;
        address wearerB;
    }

    uint8 internal constant MAX_DEPTH = 8;
    bytes32 internal constant DOC = keccak256("invariant document");

    IBudgets public immutable budgets;
    Wiring internal w;
    uint256[3] internal hatPool;
    address[3] internal wearerPool;
    uint256 public immutable boardHat;

    bool public ready;
    uint256[] public ids;
    uint256 public reentrantTop;
    /// @dev Company B's budgets and its one pending scheduled payment, set once at the start.
    uint256[] public bIds;
    uint256 public bScheduled;
    Pending[] internal _pending;
    uint256 internal _nonce;

    mapping(uint256 id => mapping(uint64 periodIndex => uint128)) public ghostOwnSpent;
    mapping(uint256 id => uint128) public ghostPending;
    mapping(uint256 id => uint128) public ghostReserved;
    uint256 public reentriesTried;
    uint256 public reentryEscapes;
    mapping(bytes32 action => uint256) public calls;

    constructor(Wiring memory wiring, uint256 boardHat_, uint256[3] memory hats_, address[3] memory wearers_) {
        w = wiring;
        budgets = wiring.budgets;
        boardHat = boardHat_;
        hatPool = hats_;
        wearerPool = wearers_;
    }

    modifier init(bytes32 action) {
        if (!ready) _init();
        ++calls[action];
        _;
    }

    // ------------------------------------------------------------------ the Board

    function createChild(uint256 parentSeed, uint128 amount, uint256 hatSeed) external init("createChild") {
        uint256 parent = _pick(parentSeed);
        if (budgets.budgetOf(parent).depth >= MAX_DEPTH || !_open(parent)) return;
        uint128 room = budgets.leftOf(parent);
        if (room == 0) return;
        amount = uint128(bound(amount, 1, room));
        (uint256 hat,) = _hat(hatSeed);
        vm.prank(_wearerOf(parent));
        ids.push(budgets.createChildBudget(parent, amount, hat));
    }

    function setAmount(uint256 idSeed, uint128 amount) external init("setAmount") {
        uint256 id = _pick(idSeed);
        IBudgets.Budget memory b = budgets.budgetOf(id);
        uint128 used = b.ownSpent + b.ownCommitted + b.childrenAmount;
        uint128 max = b.parent == 0 ? used + 1e13 : b.amount + budgets.leftOf(b.parent);
        amount = uint128(bound(amount, used, max));
        vm.prank(w.safe);
        budgets.setAmount(id, amount);
    }

    function toggleClosed(uint256 idSeed) external init("toggleClosed") {
        uint256 id = _pick(idSeed);
        bool closed = budgets.budgetOf(id).closed;
        vm.prank(w.safe);
        if (closed) budgets.reopen(id);
        else budgets.close(id);
    }

    function setHat(uint256 idSeed, uint256 hatSeed) external init("setHat") {
        uint256 id = _pick(idSeed);
        if (budgets.budgetOf(id).parent == 0) return;
        (uint256 hat,) = _hat(hatSeed);
        vm.prank(w.safe);
        budgets.setHat(id, hat);
    }

    // ------------------------------------------------------------------ hat wearers

    function spend(uint256 idSeed, uint128 amount, uint16 kind) external init("spend") {
        _spend(_pick(idSeed), amount, kind);
    }

    function schedule(uint256 idSeed, uint128 amount, uint64 delay) external init("schedule") {
        uint256 id = _pick(idSeed);
        if (!_open(id)) return;
        uint128 left = budgets.leftOf(id);
        if (left == 0) return;
        amount = uint128(bound(amount, 1, left));
        uint64 payAt = uint64(block.timestamp + bound(delay, 1, 120 days));
        vm.prank(_wearerOf(id));
        uint256 sid = budgets.schedule(
            id, makeAddr("supplier"), amount, uint16(delay % 4), payAt, DOC, keccak256(abi.encode("schedule", ++_nonce))
        );
        _pending.push(Pending(sid, id, amount, payAt));
        ghostPending[id] += amount;
    }

    function cancel(uint256 pSeed) external init("cancel") {
        if (_pending.length == 0) return;
        Pending memory p = _take(pSeed);
        vm.prank(w.safe);
        budgets.cancel(p.sid);
        ghostPending[p.id] -= p.amount;
    }

    // ------------------------------------------------------------------ anyone

    function execute(uint256 pSeed) external init("execute") {
        if (_pending.length == 0) return;
        Pending memory p = _take(pSeed);
        if (block.timestamp < p.payAt) vm.warp(p.payAt);
        vm.prank(w.anyone);
        budgets.execute(p.sid);
        ghostPending[p.id] -= p.amount;
        ghostOwnSpent[p.id][_periodOf(p.id)] += p.amount;
    }

    // ------------------------------------------------------------------ Agreements

    function commit(uint256 idSeed, uint128 amount) external init("commit") {
        uint256 id = _pick(idSeed);
        if (!_open(id)) return;
        uint128 left = budgets.leftOf(id);
        if (left == 0) return;
        amount = uint128(bound(amount, 1, left));
        vm.prank(w.agreements);
        budgets.commit(id, amount);
        ghostReserved[id] += amount;
    }

    function release(uint256 idSeed, uint128 amount) external init("release") {
        uint256 id = _pick(idSeed);
        if (ghostReserved[id] == 0) return;
        amount = uint128(bound(amount, 1, ghostReserved[id]));
        vm.prank(w.agreements);
        budgets.release(id, amount);
        ghostReserved[id] -= amount;
    }

    function payReserved(uint256 idSeed, uint128 amount) external init("payReserved") {
        uint256 id = _pick(idSeed);
        if (ghostReserved[id] == 0) return;
        amount = uint128(bound(amount, 1, ghostReserved[id]));
        vm.prank(w.agreements);
        budgets.payReserved(id, makeAddr("payee"), amount, DOC, keccak256(abi.encode("collection", ++_nonce)));
    }

    // ------------------------------------------------------------------ time

    /// @dev Moves 1 hour to 120 days: across month, quarter and year boundaries.
    function warp(uint256 seconds_) external init("warp") {
        vm.warp(block.timestamp + bound(seconds_, 1 hours, 120 days));
    }

    /// @dev N-9 / B11: into the next period, a sibling spends first (rolling the shared parent), then
    /// the child.
    function siblingFirst(uint256 idSeed, uint128 a, uint128 b) external init("siblingFirst") {
        uint256 child = _pick(idSeed);
        uint256 parent = budgets.budgetOf(child).parent;
        if (parent == 0) return;
        uint256[] memory siblings = budgets.childrenOf(parent);
        if (siblings.length < 2) return;
        uint256 sibling = siblings[0] == child ? siblings[1] : siblings[0];
        vm.warp(block.timestamp + 32 days);
        _spend(sibling, a, 0);
        _spend(child, b, 1);
    }

    // ------------------------------------------------------------------ the hostile token (D10)

    /// @dev Arms the re-entrant token with a call into a state-changing Budgets function, then the
    /// Safe spends from the token's budget. Every re-entry must be refused with `ReentrantCall`.
    function reenter(uint256 which) external init("reenter") {
        if (!_open(reentrantTop) || budgets.leftOf(reentrantTop) == 0) return;
        MockReentrantERC20 token = MockReentrantERC20(w.reentrant);
        token.arm(address(budgets), _reentry(which));
        _spend(reentrantTop, 1, 0);
        ++reentriesTried;
        bool refused = token.reentered() && !token.reentrySucceeded()
            && keccak256(token.reentryResult()) == keccak256(abi.encodeWithSelector(IBudgets.ReentrantCall.selector));
        if (!refused) ++reentryEscapes;
    }

    // ------------------------------------------------------------------ views for the invariants

    function bIdsLength() external view returns (uint256) {
        return bIds.length;
    }

    function idsLength() external view returns (uint256) {
        return ids.length;
    }

    function pendingLength() external view returns (uint256) {
        return _pending.length;
    }

    function pendingAt(uint256 i) external view returns (Pending memory) {
        return _pending[i];
    }

    function periodNow(uint256 id) external view returns (uint64) {
        return _periodOf(id);
    }

    // ------------------------------------------------------------------ internals

    function _init() internal {
        ready = true;
        vm.prank(w.deployer);
        budgets.setAgreements(w.agreements);
        vm.prank(w.safe);
        budgets.configure(w.roles, w.roleKey);
        MockERC20(w.usdc).mint(w.safe, 1e24);
        MockERC20(w.dai).mint(w.safe, 1e36);
        MockERC20(w.reentrant).mint(w.safe, 1e24);
        vm.startPrank(w.safe);
        ids.push(budgets.createTopBudget(w.usdc, 2, 10_000_000e6, boardHat));
        ids.push(budgets.createTopBudget(w.dai, 1, 1_000_000e18, boardHat));
        reentrantTop = budgets.createTopBudget(w.reentrant, 0, 1_000_000e6, boardHat);
        vm.stopPrank();
        ids.push(reentrantTop);

        // Company B: its own Safe, Roles and hats; a top budget, a child, a reservation and a
        // pending scheduled payment, all left alone from here on.
        vm.prank(w.safeB);
        budgets.configure(w.rolesB, w.roleKey);
        vm.prank(w.safeB);
        uint256 bTop = budgets.createTopBudget(w.usdc, 2, 1_000_000e6, w.boardHatB);
        vm.prank(w.safeB);
        uint256 bChild = budgets.createChildBudget(bTop, 400_000e6, w.hatB);
        vm.prank(w.wearerB);
        bScheduled = budgets.schedule(
            bChild,
            w.wearerB,
            1000e6,
            0,
            uint64(block.timestamp + 3650 days),
            DOC,
            keccak256(abi.encode("schedule", ++_nonce))
        );
        vm.prank(w.agreements);
        budgets.commit(bChild, 2000e6);
        bIds.push(bTop);
        bIds.push(bChild);
    }

    function _spend(uint256 id, uint128 amount, uint16 kind) internal {
        if (!_open(id)) return;
        uint128 left = budgets.leftOf(id);
        if (left == 0) return;
        amount = uint128(bound(amount, 1, left));
        vm.prank(_wearerOf(id));
        budgets.spend(id, makeAddr("vendor"), amount, kind % 4, DOC, keccak256(abi.encode("spend", ++_nonce)));
        ghostOwnSpent[id][_periodOf(id)] += amount;
    }

    function _pick(uint256 seed) internal view returns (uint256) {
        return ids[seed % ids.length];
    }

    function _take(uint256 seed) internal returns (Pending memory p) {
        uint256 i = seed % _pending.length;
        p = _pending[i];
        _pending[i] = _pending[_pending.length - 1];
        _pending.pop();
    }

    function _hat(uint256 seed) internal view returns (uint256 hat, address wearer) {
        uint256 i = seed % 3;
        return (hatPool[i], wearerPool[i]);
    }

    /// @dev The wearer of the budget's own hat, or the Safe for a Board-hat budget.
    function _wearerOf(uint256 id) internal view returns (address) {
        uint256 hat = budgets.budgetOf(id).hat;
        for (uint256 i; i < 3; ++i) {
            if (hatPool[i] == hat) return wearerPool[i];
        }
        return w.safe;
    }

    function _open(uint256 id) internal view returns (bool) {
        for (uint256 i; i < MAX_DEPTH; ++i) {
            if (id == 0) return true;
            IBudgets.Budget memory b = budgets.budgetOf(id);
            if (b.closed) return false;
            id = b.parent;
        }
        return true;
    }

    function _periodOf(uint256 id) internal view returns (uint64) {
        return BudgetsCalendar.periodIndex(budgets.budgetOf(id).period, block.timestamp);
    }

    function _reentry(uint256 which) internal view returns (bytes memory) {
        uint256 id = ids[0];
        uint64 later = uint64(block.timestamp + 1 days);
        bytes32 job = keccak256("reentry");
        uint256 k = which % 15;
        if (k == 0) return abi.encodeCall(IBudgets.spend, (id, address(this), 1, 0, DOC, job));
        if (k == 1) return abi.encodeCall(IBudgets.schedule, (id, address(this), 1, 0, later, DOC, bytes32("job")));
        if (k == 2) return abi.encodeCall(IBudgets.cancel, (1));
        if (k == 3) return abi.encodeCall(IBudgets.execute, (1));
        if (k == 4) return abi.encodeCall(IBudgets.commit, (id, 1));
        if (k == 5) return abi.encodeCall(IBudgets.release, (id, 1));
        if (k == 6) return abi.encodeCall(IBudgets.payReserved, (id, address(this), 1, DOC, job));
        if (k == 7) return abi.encodeCall(IBudgets.createChildBudget, (id, 1, hatPool[0]));
        if (k == 8) return abi.encodeCall(IBudgets.createTopBudget, (w.usdc, 2, 1, boardHat));
        if (k == 9) return abi.encodeCall(IBudgets.setAmount, (id, 1));
        if (k == 10) return abi.encodeCall(IBudgets.setHat, (id, hatPool[1]));
        if (k == 11) return abi.encodeCall(IBudgets.close, (id));
        if (k == 12) return abi.encodeCall(IBudgets.reopen, (id));
        if (k == 13) return abi.encodeCall(IBudgets.configure, (w.roles, w.roleKey));
        return abi.encodeCall(IBudgets.setAgreements, (address(this)));
    }
}
