// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";

import { Agreements } from "../../../src/money/Agreements.sol";
import { IAgreements } from "../../../src/interfaces/IAgreements.sol";
import { IBudgets } from "../../../src/interfaces/IBudgets.sol";
import { MockERC20 } from "../../mocks/MockERC20.sol";
import { MockHats } from "../../mocks/MockHats.sol";
import { MockReentrantERC20 } from "../../mocks/MockReentrantERC20.sol";
import { MockRoles } from "../../mocks/MockRoles.sol";
import { CalendarModel } from "../../utils/Agreements/CalendarModel.sol";
import { MockBudgets } from "../../utils/Agreements/MockBudgets.sol";

/// @notice The Agreements differential handler (invariants.md A12; ports beta
/// `PayrollDepartmentsHandler`, `packages/contracts/test/fork/PayrollDepartmentsInvariant.fork.t.sol:16-472`).
/// Every call first asks an independent model, written from spec/agreements.md and spec/budgets.md,
/// whether it should succeed (authority, budget room, lifecycle, expiry, dates, amounts, the payout
/// path), then makes it with `try` and counts any wrong acceptance or wrong refusal. The model also keeps
/// every agreement's exact pay by its own calendar (CalendarModel) and what each agreement should hold
/// reserved in storage, so the suite can compare both.
///
/// Actors (named): the Board (the company Safe), Amira (CEO hat: Operating, above Operations), Jordan
/// (Ops hat: Operations, Monthly, Re-entrant; his standing can lapse), Ben (Other company's hat), the other
/// company's Safe, and Eve, who wears nothing. Payees are fresh addresses, one per agreement.
contract AgreementsHandler is Test {
    uint64 internal constant MONTHLY = type(uint64).max;
    uint256 internal constant SCALE = CalendarModel.SCALE;
    bytes32 internal constant TERMS = keccak256("agreement terms document");
    uint256 internal constant ACTORS = 6;
    uint256 internal constant BUDGETS = 4;

    /// @dev One agreement as the model sees it. The pay half is beta's model; the storage half is what
    /// Agreements should hold, changed only where the contract brings an agreement up to date.
    struct M {
        uint256 budget; // index into `budgetIds`
        address payee;
        uint8 period;
        uint64 step;
        uint128 rate; // pay model
        uint128 pendingRate;
        uint64 pendingAt;
        uint64 endsAt;
        uint64 startsAt;
        uint64 offerExpiresAt;
        uint64 accruedAt;
        bool accepted;
        bool paused;
        bool fixedTerm;
        uint256 scaled;
        uint256 released;
        uint128 collected;
        uint64 collections;
        uint128 reservedS; // storage model
        uint128 rateS;
        uint128 pendingRateS;
        uint64 pendingAtS;
        bool closedS;
        bool listed;
        uint128 reservedAtOffer;
        uint256 twin; // A6: an identical agreement never collected
        bool isTwin;
        uint256 offeredBy; // actor index
    }

    Agreements public immutable agreements;
    MockBudgets public immutable budgets;
    MockHats public immutable hats;
    MockRoles public immutable roles;
    MockReentrantERC20 public immutable reentrantToken;
    address public immutable safe;
    address public immutable otherSafe;
    uint256 public immutable opsHat;
    bytes32 public immutable payoutKey;

    address[ACTORS] public actors; // 0 Board, 1 Amira, 2 Jordan, 3 Ben, 4 other Safe, 5 Eve
    uint256[BUDGETS] public budgetIds; // 0 Operations, 1 Monthly, 2 Re-entrant, 3 Other company
    uint256 public operating;
    uint8[BUDGETS] public budgetPeriod;
    address[BUDGETS] public tokenOf;
    uint128[BUDGETS] public amountOf;
    bool[BUDGETS] public closedOf;
    bool public operatingClosed;
    bool public jordanGood = true;
    /// @dev The Roles payout allowance per token as the model knows it; max means unlimited.
    mapping(address token => uint256) public allowanceLeft;

    uint256[] public ids;
    mapping(uint256 id => M) internal _m;

    uint256 public wrongAcceptances;
    uint256 public wrongRefusals;
    uint256 public a3Violations;
    uint256 public a8Violations;
    uint256 public a11Violations;
    uint256 public crossSafeAccepted;
    mapping(bytes32 fn => uint256) public accepted;
    mapping(bytes32 fn => uint256) public refused;
    mapping(bytes32 fn => uint256) public calls;
    bytes32[11] public fns = [
        bytes32("offer"),
        "accept",
        "withdrawOffer",
        "raise",
        "lower",
        "cancelChange",
        "pause",
        "resume",
        "end",
        "collect",
        "settle"
    ];

    constructor(
        Agreements agreements_,
        MockBudgets budgets_,
        MockHats hats_,
        MockRoles roles_,
        MockReentrantERC20 reentrantToken_,
        address[ACTORS] memory actors_,
        uint256[BUDGETS] memory budgetIds_,
        uint256 operating_,
        uint256 opsHat_,
        bytes32 payoutKey_
    ) {
        agreements = agreements_;
        budgets = budgets_;
        hats = hats_;
        roles = roles_;
        reentrantToken = reentrantToken_;
        actors = actors_;
        budgetIds = budgetIds_;
        operating = operating_;
        opsHat = opsHat_;
        payoutKey = payoutKey_;
        safe = actors_[0];
        otherSafe = actors_[4];
        for (uint256 b; b < BUDGETS; ++b) {
            MockBudgets.B memory info = _info(budgetIds_[b]);
            budgetPeriod[b] = info.period;
            tokenOf[b] = info.token;
            amountOf[b] = info.amount;
            allowanceLeft[info.token] = type(uint256).max;
        }
    }

    // ================================================================== actions

    /// @dev An actor offers from a budget: open-ended or, one time in three, a fixed term of up to 400 days;
    /// one time in eight with a defect (a zero step, an unknown period, a zero document or a self-offer).
    /// One offer in three gets a twin with the same terms (A6). The payee mostly accepts at once.
    function offer(
        uint8 actorSeed,
        uint8 budgetSeed,
        uint96 rateSeed,
        uint8 stepSeed,
        uint32 expirySeed,
        uint32 termSeed
    )
        public
    {
        uint256 b = budgetSeed % BUDGETS;
        uint256 actor = _pickActor(actorSeed, b);
        uint256 id = _offer(actor, b, rateSeed, stepSeed, expirySeed, termSeed, 0);
        if (id != 0 && termSeed % 3 == 1) {
            uint256 twin = _offer(actor, b, rateSeed, stepSeed, expirySeed, termSeed, id);
            if (twin != 0) {
                _m[id].twin = twin;
                _m[twin].isTwin = true;
            }
        }
        if (id != 0 && rateSeed % 4 != 0) _accept(id, actorSeed % 7 == 0 ? 5 : 99, expirySeed % 9 == 0);
    }

    /// @dev Up to 20 small offers at once, so a budget reaches its 64 open agreements (A2 at 64).
    function offerMany(uint8 actorSeed, uint8 budgetSeed, uint8 count) external {
        uint256 n = bound(count, 1, 20);
        for (uint256 i; i < n; ++i) {
            uint256 b = budgetSeed % BUDGETS;
            uint256 id = _offer(_pickActor(actorSeed, b), b, 1e6, uint8(i), 14 days + 1, 1, 0);
            if (id != 0 && i % 4 != 0) _accept(id, 99, false);
        }
    }

    /// @dev The payee (or, sometimes, Eve or the offering actor, or the right caller with the wrong terms)
    /// accepts an offer and its twin.
    function accept(uint256 idSeed, uint8 callerSeed, bool wrongTerms) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        if (_m[id].isTwin) return;
        uint256 caller = callerSeed % 5 == 0 ? 5 : callerSeed % 5 == 1 ? _m[id].offeredBy : 99;
        _accept(id, caller, wrongTerms && callerSeed % 3 == 0);
    }

    function withdrawOffer(uint256 idSeed, uint8 actorSeed) external {
        _onPair(idSeed, actorSeed, this.withdrawOne, 0, 0);
    }

    /// @dev A raise by up to half again of the rate.
    function raise(uint256 idSeed, uint8 actorSeed, uint96 addSeed) external {
        _onPair(idSeed, actorSeed, this.raiseOne, addSeed, 0);
    }

    /// @dev A lowering effective now or up to 60 days out.
    function lower(uint256 idSeed, uint8 actorSeed, uint96 cutSeed, uint32 delaySeed) external {
        _onPair(idSeed, actorSeed, this.lowerOne, cutSeed, delaySeed);
    }

    function cancelChange(uint256 idSeed, uint8 actorSeed) external {
        _onPair(idSeed, actorSeed, this.cancelOne, 0, 0);
    }

    function pause(uint256 idSeed, uint8 actorSeed) external {
        _onPair(idSeed, actorSeed, this.pauseOne, 0, 0);
    }

    function resume(uint256 idSeed, uint8 actorSeed) external {
        _onPair(idSeed, actorSeed, this.resumeOne, 0, 0);
    }

    /// @dev An end now or up to 90 days out.
    function end(uint256 idSeed, uint8 actorSeed, uint32 delaySeed) external {
        _onPair(idSeed, actorSeed, this.endOne, delaySeed, 0);
    }

    /// @dev The payee (one time in eleven, Eve) collects a share of what is released, sometimes one unit more. On a
    /// re-entrant token the transfer calls a state-changing Agreements function, which must be refused
    /// (A11). A refused collection must leave the agreement as it was (A8).
    function collect(uint256 idSeed, uint8 percent, uint8 reentrySeed) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        M memory m = _m[id];
        if (m.isTwin) return; // the twin is never collected (A6)
        calls["collect"]++;
        _advance(id);
        m = _m[id];
        uint128 available = _sat(m.released / SCALE, m.collected);
        // Mostly a share of what is released; one time in five one unit more, which must be refused.
        uint128 amount = percent % 5 == 0 ? available + 1 : uint128(uint256(available) * bound(percent, 1, 100) / 100);
        address token = tokenOf[m.budget];
        address caller = reentrySeed % 11 == 0 ? actors[5] : m.payee;
        // Only the company's Roles allowance is squeezed; the other company's is unlimited.
        uint256 allowance = m.budget == 3 ? type(uint256).max : allowanceLeft[token];
        bool ok = caller == m.payee && m.accepted && amount != 0 && amount <= available && amount <= allowance
            && amount <= MockERC20(token).balanceOf(_safeOf(m.budget));
        if (token == address(reentrantToken)) reentrantToken.arm(address(agreements), _reentryCall(id, reentrySeed));
        bytes32 before = _snapshot(id);
        vm.prank(caller);
        try agreements.collect(id, amount) {
            _count("collect", ok, true, m.budget, address(0));
            M storage s = _m[id];
            s.collected += amount;
            s.collections++;
            if (allowance != type(uint256).max) allowanceLeft[token] -= amount;
            _storeTouched(id);
            if (token == address(reentrantToken) && reentrantToken.reentered()) {
                bool refusedRight = !reentrantToken.reentrySucceeded()
                    && bytes4(reentrantToken.reentryResult()) == IAgreements.ReentrantCall.selector;
                if (!refusedRight) a11Violations++;
            }
        } catch {
            _count("collect", ok, false, m.budget, address(0));
            if (_snapshot(id) != before) a8Violations++;
        }
        if (token == address(reentrantToken)) reentrantToken.arm(address(0), "");
    }

    /// @dev Anyone settles a budget.
    function settle(uint8 budgetSeed, uint8 actorSeed) external {
        uint256 b = budgetSeed % BUDGETS;
        calls["settle"]++;
        vm.prank(actors[actorSeed % ACTORS]);
        try agreements.settle(budgetIds[b]) {
            _count("settle", true, true, b, address(0));
            _settleModel(b);
        } catch {
            _count("settle", true, false, b, address(0));
        }
    }

    /// @dev The budget side: a lower or higher amount (refused below what is committed, D8), a budget or
    /// Operating closed or reopened, Jordan's standing lapsing or returning, the payout allowance squeezed
    /// or restored, the Safe's balance run low or refilled.
    function budgetSide(uint8 what, uint8 budgetSeed, uint96 amountSeed) external {
        uint256 b = budgetSeed % BUDGETS;
        uint256 kind = what % 6;
        if (kind == 0) {
            uint128 amount = uint128(bound(amountSeed, 0, 300_000e6));
            try budgets.setAmount(budgetIds[b], amount) {
                amountOf[b] = amount;
            } catch { }
        } else if (kind == 1) {
            closedOf[b] = !closedOf[b];
            budgets.setClosed(budgetIds[b], closedOf[b]);
        } else if (kind == 2) {
            operatingClosed = !operatingClosed;
            budgets.setClosed(operating, operatingClosed);
        } else if (kind == 3) {
            jordanGood = !jordanGood;
            hats.setStanding(opsHat, actors[2], jordanGood);
        } else if (kind == 4) {
            if (b == 3) return; // the company's own Roles only
            address token = tokenOf[b];
            uint256 left = amountSeed % 2 == 0 ? type(uint256).max : bound(amountSeed, 0, 5000e6);
            roles.setAllowance(payoutKey, token, left);
            allowanceLeft[token] = left;
        } else {
            address token = tokenOf[b];
            deal(token, _safeOf(b), amountSeed % 2 == 0 ? 1e18 : bound(amountSeed, 0, 5000e6));
        }
    }

    /// @dev Time moves by an hour to 30 days, or to a second either side of the next month start. Before
    /// it moves, earned pay of every paused or ended agreement is read; it must not change (A3).
    function warp(uint32 secondsSeed) external {
        calls["warp"]++;
        uint256 n = ids.length;
        uint128[] memory frozen = new uint128[](n);
        bool[] memory watch = new bool[](n);
        for (uint256 i; i < n; ++i) {
            M storage m = _m[ids[i]];
            if (!m.accepted || !(m.paused || (m.endsAt != 0 && m.endsAt <= block.timestamp))) continue;
            try agreements.earnedOf(ids[i]) returns (uint128 e) {
                frozen[i] = e;
                watch[i] = true;
            } catch { }
        }
        if (secondsSeed % 4 == 0) {
            vm.warp(CalendarModel.nextMonthStart(block.timestamp) - 1 + secondsSeed % 3);
        } else {
            vm.warp(block.timestamp + bound(secondsSeed, 1 hours, 30 days));
        }
        for (uint256 i; i < n; ++i) {
            if (!watch[i]) continue;
            try agreements.earnedOf(ids[i]) returns (uint128 e) {
                if (e != frozen[i]) a3Violations++;
            } catch {
                a3Violations++;
            }
        }
    }

    // ================================================================== one agreement, by actor

    function withdrawOne(uint256 id, uint256 actor, uint256, uint256) external returns (bool) {
        _self();
        M memory t = _touched(_m[id]);
        bool ok = _authorised(id, actor) && !_m[id].accepted && !t.closedS;
        bool done = _act(actor, abi.encodeCall(IAgreements.withdrawOffer, (id)), "withdrawOffer", ok, id);
        if (done) {
            _storeTouched(id);
            _release(id, _m[id].reservedS);
            _m[id].closedS = true;
        }
        return done;
    }

    function raiseOne(uint256 id, uint256 actor, uint256 addSeed, uint256) external returns (bool) {
        _self();
        M memory t = _touched(_m[id]);
        uint128 newRate = t.rateS + uint128(bound(addSeed, 1, t.rateS / 2 + 1));
        uint128 diff = _figure(newRate, t.period, t.budget) - _figure(t.rateS, t.period, t.budget);
        bool ok = _authorised(id, actor) && _m[id].accepted && t.endsAt == 0 && t.pendingAtS == 0
            && !_pathClosed(t.budget) && uint256(_committedAfterSettle(t.budget)) + diff <= amountOf[t.budget];
        bool done = _act(actor, abi.encodeCall(IAgreements.changeRate, (id, newRate, 0)), "raise", ok, id);
        if (done) {
            _settleModel(t.budget);
            M storage m = _m[id];
            m.reservedS += diff;
            m.rateS = newRate;
            _committed[t.budget] += diff;
            _advance(id);
            m.rate = newRate;
        }
        return done;
    }

    function lowerOne(uint256 id, uint256 actor, uint256 cutSeed, uint256 delaySeed) external returns (bool) {
        _self();
        M memory t = _touched(_m[id]);
        if (t.rateS < 2) return false;
        uint128 newRate = t.rateS - uint128(bound(cutSeed, 1, t.rateS - 1));
        uint64 effectiveAt = uint64(block.timestamp + bound(delaySeed, 0, 60 days));
        bool ok = _authorised(id, actor) && _m[id].accepted && t.endsAt == 0 && t.pendingAtS == 0;
        bytes memory data = abi.encodeCall(IAgreements.changeRate, (id, newRate, effectiveAt));
        bool done = _act(actor, data, "lower", ok, id);
        if (done) {
            _storeTouched(id);
            _advance(id);
            M storage m = _m[id];
            (m.pendingRate, m.pendingAt, m.pendingRateS, m.pendingAtS) = (newRate, effectiveAt, newRate, effectiveAt);
            _storeTouched(id);
        }
        return done;
    }

    function cancelOne(uint256 id, uint256 actor, uint256, uint256) external returns (bool) {
        _self();
        M memory t = _touched(_m[id]);
        bool ok = _authorised(id, actor) && _m[id].accepted && !t.closedS && t.pendingAtS != 0;
        bool done = _act(actor, abi.encodeCall(IAgreements.cancelChange, (id)), "cancelChange", ok, id);
        if (done) {
            _storeTouched(id);
            _advance(id);
            M storage m = _m[id];
            (m.pendingRate, m.pendingAt, m.pendingRateS, m.pendingAtS) = (0, 0, 0, 0);
        }
        return done;
    }

    function pauseOne(uint256 id, uint256 actor, uint256, uint256) external returns (bool) {
        _self();
        M memory t = _touched(_m[id]);
        bool ok = _authorised(id, actor) && _m[id].accepted && !_m[id].paused && !t.closedS;
        bool done = _act(actor, abi.encodeCall(IAgreements.pause, (id)), "pause", ok, id);
        if (done) {
            _storeTouched(id);
            _advance(id);
            _m[id].paused = true;
        }
        return done;
    }

    function resumeOne(uint256 id, uint256 actor, uint256, uint256) external returns (bool) {
        _self();
        M memory t = _touched(_m[id]);
        bool ok = _authorised(id, actor) && _m[id].accepted && _m[id].paused && !t.closedS;
        bool done = _act(actor, abi.encodeCall(IAgreements.resume, (id)), "resume", ok, id);
        if (done) {
            _storeTouched(id);
            _advance(id);
            _m[id].paused = false;
        }
        return done;
    }

    function endOne(uint256 id, uint256 actor, uint256 delaySeed, uint256) external returns (bool) {
        _self();
        uint64 endsAt = uint64(block.timestamp + bound(delaySeed, 0, 90 days));
        M storage m = _m[id];
        bool ok = _authorised(id, actor) && m.accepted && (m.endsAt == 0 || endsAt < m.endsAt);
        bool done = _act(actor, abi.encodeCall(IAgreements.end, (id, endsAt)), "end", ok, id);
        if (done) {
            _storeTouched(id);
            _advance(id);
            m.endsAt = endsAt;
            _storeTouched(id);
        }
        return done;
    }

    // ================================================================== model reads for the suite

    function idCount() external view returns (uint256) {
        return ids.length;
    }

    function modelOf(uint256 id) external view returns (M memory) {
        return _m[id];
    }

    /// @notice The model's exact pay now, scaled: earned and released.
    function entitlementOf(uint256 id) public view returns (uint256 earned, uint256 released) {
        M memory m = _m[id];
        _advanceMemory(m, uint64(block.timestamp));
        return (m.scaled, m.released);
    }

    function availableOf(uint256 id) external view returns (uint128) {
        (, uint256 released) = entitlementOf(id);
        return _sat(released / SCALE, _m[id].collected);
    }

    function earnedOf(uint256 id) external view returns (uint128) {
        (uint256 earned,) = entitlementOf(id);
        return _sat(earned / SCALE, _m[id].collected);
    }

    /// @notice What the model says budget `b` holds committed in storage now.
    function committedOf(uint256 b) external view returns (uint128) {
        return _committed[b];
    }

    /// @notice How many of budget `b`'s agreements the model says are in its open list.
    function listedOf(uint256 b) external view returns (uint256 n) {
        for (uint256 i; i < ids.length; ++i) {
            if (_m[ids[i]].budget == b && _m[ids[i]].listed) ++n;
        }
    }

    function figureOf(uint256 id) external view returns (uint128) {
        M storage m = _m[id];
        return _figure(m.rateS, m.period, m.budget);
    }

    // ================================================================== the model

    mapping(uint256 b => uint128) internal _committed;

    /// @dev The offer's defect, if any: 0 none, 1 a zero step, 2 an unknown period, 3 a zero document hash,
    /// 4 a self-offer (F10).
    struct Draft {
        uint256 actor;
        uint256 defect;
        uint128 reservation;
    }

    struct Seeds {
        uint96 rate;
        uint8 step;
        uint32 expiry;
        uint32 term;
    }

    function _offer(
        uint256 actor,
        uint256 b,
        uint96 rateSeed,
        uint8 stepSeed,
        uint32 expirySeed,
        uint32 termSeed,
        uint256 twinOf
    )
        internal
        returns (uint256)
    {
        if (twinOf == 0) calls["offer"]++;
        M memory m = _newModel(b, Seeds(rateSeed, stepSeed, expirySeed, termSeed));
        m.offeredBy = actor;
        Draft memory d = Draft({
            actor: actor,
            defect: twinOf == 0 && expirySeed % 8 == 0 ? 1 + (termSeed >> 3) % 4 : 0,
            reservation: m.reservedAtOffer
        });
        return _offerAndRecord(m, d, twinOf != 0);
    }

    function _offerAndRecord(M memory m, Draft memory d, bool isTwin) internal returns (uint256 id) {
        uint256 b = m.budget;
        bool ok = d.defect == 0 && _authorisedFor(b, d.actor) && !_pathClosed(b)
            && uint256(_committedAfterSettle(b)) + d.reservation <= amountOf[b] && _openAfterSettle(b) < 64;
        (bool done, bytes memory ret) = _offerCall(m, d);
        if (!isTwin) _count("offer", ok, done, b, actors[d.actor]);
        else if (done != ok) done ? wrongAcceptances++ : wrongRefusals++;
        if (!done) return 0;
        id = abi.decode(ret, (uint256));
        _settleModel(b);
        m.reservedS = d.reservation;
        m.rateS = m.rate;
        m.listed = true;
        _committed[b] += d.reservation;
        _m[id] = m;
        ids.push(id);
    }

    function _newModel(uint256 b, Seeds memory seeds) internal view returns (M memory m) {
        (uint96 rateSeed, uint8 stepSeed, uint32 expirySeed, uint32 termSeed) =
            (seeds.rate, seeds.step, seeds.expiry, seeds.term);
        m.budget = b;
        m.period = uint8(rateSeed % 3);
        // Up to 60,000 a year, 5,000 a month or 1,150 a week, odd amounts included.
        m.rate = uint128(bound(rateSeed, 1, m.period == 2 ? 60_000e6 : m.period == 1 ? 5000e6 : 1150e6));
        m.step = _step(stepSeed);
        m.startsAt = uint64(block.timestamp);
        m.accruedAt = m.startsAt;
        m.offerExpiresAt = uint64(block.timestamp + bound(expirySeed, 1, 14 days));
        m.reservedAtOffer = _figure(m.rate, m.period, b);
        if (termSeed % 3 == 0) {
            m.endsAt = uint64(block.timestamp + bound(termSeed, 1 hours, 400 days));
            if (m.offerExpiresAt > m.endsAt) m.offerExpiresAt = m.endsAt;
            uint256 exact = CalendarModel.units(m.rate, m.period, block.timestamp, m.endsAt);
            if (exact < m.reservedAtOffer) m.reservedAtOffer = uint128(exact);
            m.fixedTerm = true;
        }
        m.payee = address(uint160(0x100000 + ids.length));
    }

    function _offerCall(M memory m, Draft memory d) internal returns (bool done, bytes memory ret) {
        bytes memory data = abi.encodeCall(
            IAgreements.offer,
            (
                budgetIds[m.budget],
                d.defect == 4 ? actors[d.actor] : m.payee,
                m.rate,
                d.defect == 2 ? 3 : m.period,
                0,
                m.endsAt,
                d.defect == 1 ? 0 : m.step,
                m.offerExpiresAt,
                d.defect == 3 ? bytes32(0) : TERMS
            )
        );
        vm.prank(actors[d.actor]);
        (done, ret) = address(agreements).call(data);
    }

    function _accept(uint256 id, uint256 caller, bool wrongTerms) internal {
        calls["accept"]++;
        M storage m = _m[id];
        address who = caller == 99 ? m.payee : actors[caller];
        bool ok = who == m.payee && !wrongTerms && !m.accepted && !m.closedS && block.timestamp < m.offerExpiresAt;
        uint256 twin = m.twin;
        vm.prank(who);
        try agreements.accept(id, wrongTerms ? keccak256("other terms") : TERMS) {
            _count("accept", ok, true, m.budget, address(0));
            _markAccepted(m);
        } catch {
            _count("accept", ok, false, m.budget, address(0));
        }
        if (twin == 0) return;
        M storage tw = _m[twin];
        bool okTwin =
            !wrongTerms && who == m.payee && !tw.accepted && !tw.closedS && block.timestamp < tw.offerExpiresAt;
        vm.prank(who == m.payee ? tw.payee : who);
        try agreements.accept(twin, wrongTerms ? keccak256("other terms") : TERMS) {
            if (!okTwin) wrongAcceptances++;
            _markAccepted(tw);
        } catch {
            if (okTwin) wrongRefusals++;
        }
    }

    function _markAccepted(M storage m) internal {
        m.accepted = true;
        if (m.startsAt < block.timestamp) {
            m.startsAt = uint64(block.timestamp);
            m.accruedAt = uint64(block.timestamp);
        }
    }

    /// @dev Runs one of the per-agreement actions on an agreement and, if it has a twin, on the twin by the
    /// same actor. A twin whose outcome differs from its primary's is let go from the A6 comparison.
    function _onPair(
        uint256 idSeed,
        uint8 actorSeed,
        function(uint256, uint256, uint256, uint256) external returns (bool) one,
        uint256 x,
        uint256 y
    )
        internal
    {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        if (_m[id].isTwin) return;
        uint256 actor = _pickActor(actorSeed, _m[id].budget);
        bool done = one(id, actor, x, y);
        uint256 twin = _m[id].twin;
        if (twin != 0 && one(twin, actor, x, y) != done) _m[id].twin = 0;
    }

    /// @dev Makes a guarded call as `actor` and counts the outcome against `ok`.
    function _act(uint256 actor, bytes memory data, bytes32 fn, bool ok, uint256 id) internal returns (bool done) {
        if (!_m[id].isTwin) calls[fn]++;
        vm.prank(actors[actor]);
        (done,) = address(agreements).call(data);
        if (_m[id].isTwin) {
            if (done != ok) done ? wrongAcceptances++ : wrongRefusals++;
            return done;
        }
        _count(fn, ok, done, _m[id].budget, actors[actor]);
    }

    function _count(bytes32 fn, bool ok, bool done, uint256 b, address caller) internal {
        done ? accepted[fn]++ : refused[fn]++;
        if (done != ok) done ? wrongAcceptances++ : wrongRefusals++;
        if (done && caller != address(0) && _isOtherCompany(caller) != (b == 3)) {
            // A Board or hat wearer of one Safe changed the other Safe's agreements (B7).
            if (caller != actors[5]) crossSafeAccepted++;
        }
    }

    function _isOtherCompany(address caller) internal view returns (bool) {
        return caller == actors[3] || caller == actors[4];
    }

    /// @dev What `budget.settle` does to the model: brings every agreement of `b` up to date and drops the
    /// closed ones from the open list.
    function _settleModel(uint256 b) internal {
        for (uint256 i; i < ids.length; ++i) {
            uint256 id = ids[i];
            if (_m[id].budget != b) continue;
            _storeTouched(id);
            if (_m[id].closedS) _m[id].listed = false;
        }
    }

    /// @dev Applies `_touched` to storage and moves the freed amount out of the budget.
    function _storeTouched(uint256 id) internal {
        M memory m = _m[id];
        uint128 before = m.reservedS;
        bool wasClosed = m.closedS;
        m = _touched(m);
        _committed[m.budget] -= (before - m.reservedS);
        if (m.closedS && !wasClosed) _committed[m.budget] -= m.reservedS;
        _m[id] = m;
    }

    function _release(uint256 id, uint128 amount) internal {
        _committed[_m[id].budget] -= amount;
    }

    /// @dev Beta `_accrue`'s effect on the reservation (`PayrollDepartments.sol:568-588`): an expired offer
    /// closes; a due lowering frees the figure difference; a passed end closes. `reservedS` keeps the last
    /// reservation, as the contract's record does.
    function _touched(M memory m) internal view returns (M memory) {
        if (m.closedS) return m;
        if (!m.accepted) {
            if (block.timestamp >= m.offerExpiresAt) m.closedS = true;
            return m;
        }
        uint64 stop = m.endsAt != 0 && m.endsAt < block.timestamp ? m.endsAt : uint64(block.timestamp);
        if (m.pendingAtS != 0 && m.pendingAtS <= stop) {
            m.reservedS -= _figure(m.rateS, m.period, m.budget) - _figure(m.pendingRateS, m.period, m.budget);
            m.rateS = m.pendingRateS;
            m.pendingAtS = 0;
            m.pendingRateS = 0;
        }
        if (m.endsAt != 0 && block.timestamp >= m.endsAt) m.closedS = true;
        return m;
    }

    function _committedAfterSettle(uint256 b) internal view returns (uint128 total) {
        for (uint256 i; i < ids.length; ++i) {
            M memory m = _m[ids[i]];
            if (m.budget != b) continue;
            m = _touched(m);
            if (!m.closedS) total += m.reservedS;
        }
    }

    function _openAfterSettle(uint256 b) internal view returns (uint256 n) {
        for (uint256 i; i < ids.length; ++i) {
            M memory m = _m[ids[i]];
            if (m.budget == b && !_touched(m).closedS) ++n;
        }
    }

    /// @dev Three times in four someone who acts for budget `b` (its Board, its hat wearer, or for Operations
    /// Amira above it); otherwise anyone, Eve and the other company included.
    function _pickActor(uint8 seed, uint256 b) internal pure returns (uint256) {
        if (seed % 4 == 0) return (seed / 4) % ACTORS;
        if (b == 3) return seed % 2 == 0 ? 3 : 4;
        uint256 k = seed % 3;
        return k == 0 ? 0 : k == 1 && b == 0 ? 1 : 2;
    }

    function _authorised(uint256 id, uint256 actor) internal view returns (bool) {
        return _authorisedFor(_m[id].budget, actor);
    }

    /// @dev spec/budgets.md `authorised`: the budget's Safe, or a wearer in good standing of its hat or a hat
    /// above it. Operations: the Board, Amira (Operating above it) and Jordan; Monthly and Re-entrant: the
    /// Board and Jordan; the other company's budget: its Safe and Ben.
    function _authorisedFor(uint256 b, uint256 actor) internal view returns (bool) {
        if (b == 3) return actor == 3 || actor == 4;
        if (actor == 0) return true;
        if (actor == 2) return jordanGood;
        return actor == 1 && b == 0;
    }

    function _pathClosed(uint256 b) internal view returns (bool) {
        return closedOf[b] || (b == 0 && operatingClosed);
    }

    function _safeOf(uint256 b) internal view returns (address) {
        return b == 3 ? otherSafe : safe;
    }

    function _figure(uint128 rate, uint8 period, uint256 b) internal view returns (uint128) {
        return uint128(CalendarModel.periodFigure(rate, period, budgetPeriod[b]));
    }

    function _advance(uint256 id) internal {
        M memory m = _m[id];
        _advanceMemory(m, uint64(block.timestamp));
        _m[id] = m;
    }

    /// @dev Pay earned by the second; released by whole steps from the start, and in full at the end date
    /// (beta `PayrollDepartmentsHandler._advanceMemory`).
    function _advanceMemory(M memory m, uint64 t) internal pure {
        if (!m.accepted) return;
        uint64 stop = m.endsAt != 0 && m.endsAt < t ? m.endsAt : t;
        if (m.pendingAt != 0 && m.pendingAt <= stop) {
            _grow(m, m.pendingAt);
            m.rate = m.pendingRate;
            m.pendingAt = 0;
            m.pendingRate = 0;
        }
        _grow(m, stop);
        if (m.endsAt != 0 && t >= m.endsAt) m.released = m.scaled;
    }

    function _grow(M memory m, uint64 to) internal pure {
        if (to <= m.accruedAt) return;
        uint256 rate = m.paused ? 0 : m.rate;
        uint256 lastStep =
            m.step == MONTHLY ? CalendarModel.monthStart(to) : m.startsAt + uint256(to - m.startsAt) / m.step * m.step;
        if (lastStep > m.accruedAt) m.released = m.scaled + CalendarModel.pay(rate, m.period, m.accruedAt, lastStep);
        m.scaled += CalendarModel.pay(rate, m.period, m.accruedAt, to);
        m.accruedAt = to;
    }

    /// @dev A stream, an hour, early access by the day, a week, or each calendar month.
    function _step(uint8 seed) internal pure returns (uint64) {
        uint64[5] memory steps = [uint64(1), 1 hours, 1 days, 7 days, MONTHLY];
        return steps[seed % 5];
    }

    /// @dev A state-changing call the re-entrant token makes mid-collection (A11).
    function _reentryCall(uint256 id, uint8 seed) internal view returns (bytes memory) {
        uint256 k = seed % 8;
        if (k == 0) return abi.encodeCall(IAgreements.collect, (id, 1));
        if (k == 1) return abi.encodeCall(IAgreements.settle, (budgetIds[2]));
        if (k == 2) return abi.encodeCall(IAgreements.pause, (id));
        if (k == 3) return abi.encodeCall(IAgreements.end, (id, uint64(block.timestamp)));
        if (k == 4) return abi.encodeCall(IAgreements.changeRate, (id, 1, uint64(block.timestamp)));
        if (k == 5) return abi.encodeCall(IAgreements.accept, (id, TERMS));
        if (k == 6) return abi.encodeCall(IAgreements.withdrawOffer, (id));
        return abi.encodeCall(
            IAgreements.offer, (budgetIds[2], address(this), 1e6, 1, 0, 0, 1, uint64(block.timestamp + 1 days), TERMS)
        );
    }

    /// @dev The agreement's stored record and figures, hashed, to compare before and after a refusal (A8).
    function _snapshot(uint256 id) internal view returns (bytes32) {
        try agreements.agreementOf(id) returns (IAgreements.Agreement memory a) {
            uint128 available;
            try agreements.availableOf(id) returns (uint128 v) {
                available = v;
            } catch { }
            return keccak256(abi.encode(a.collected, a.collections, a.earnedScaled, a.releasedScaled, available));
        } catch {
            return bytes32(0);
        }
    }

    function _info(uint256 budgetId) internal view returns (MockBudgets.B memory info) {
        IBudgets.Budget memory b = budgets.budgetOf(budgetId);
        info.safe = b.safe;
        info.token = b.token;
        info.period = b.period;
        info.amount = b.amount;
    }

    function _sat(uint256 a, uint128 b) internal pure returns (uint128) {
        return a > b ? uint128(a - b) : 0;
    }

    function _self() internal view {
        require(msg.sender == address(this), "internal");
    }
}
