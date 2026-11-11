// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { StdUtils } from "forge-std/StdUtils.sol";
import { Vm } from "forge-std/Vm.sol";

import { IVesting } from "../../../src/interfaces/IVesting.sol";
import { CalendarModel } from "../../utils/Calendar/CalendarModel.sol";
import { MockCaptableForVesting } from "../../utils/Vesting/MockCaptableForVesting.sol";

/// @notice The honest actors of the Vesting suite: the Board (the company Safe) grants, offers, revokes and
/// accelerates; Exits accelerates at a sale; the shareholders (Amira, Ben, Alice, Bob) accept offers and move
/// their free shares; anyone settles, releases and lapses; the investor gives shares (transfer in). Every input
/// is bounded and every call is made only when the spec says it succeeds, so with `fail_on_revert` a revert is
/// a bug. Ghosts record what V1, V3, V4 and V5 need.
contract VestingHandler is StdUtils {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint8 internal constant COMMON = 0;
    uint256 internal constant MAX_GRANTS = 40;
    bytes32 internal constant DOC = keccak256("grant agreement");
    bytes32 internal constant DOC2 = keccak256("board resolution: accelerate");

    IVesting public immutable vesting;
    MockCaptableForVesting public immutable captable;
    address public immutable safe;
    address public immutable exits;
    address public immutable investor;
    IERC20 public immutable token;

    address[] internal _shareholders;
    uint256[] public ids;
    mapping(uint256 id => bool) public lapsed;
    /// @dev 1: made live by grantAndIssue; 2: offered.
    mapping(uint256 id => uint8) public origin;
    /// @dev Who called acceptGrant successfully on an offer.
    mapping(uint256 id => address) public acceptedBy;
    /// @dev `vm.getBlockTimestamp()` when revoke was called (V3).
    mapping(uint256 id => uint64) public revokeCalledAt;
    mapping(uint256 id => uint128) public lastLocked;
    mapping(uint256 id => bool) public seen;

    bool public v1Breach;
    bool public v5Breach;
    /// @dev V3: the Board's revoke with an effective date in the past succeeded.
    bool public v3Breach;

    constructor(
        IVesting vesting_,
        MockCaptableForVesting captable_,
        address investor_,
        address[] memory shareholders_
    ) {
        vesting = vesting_;
        captable = captable_;
        safe = captable_.safe();
        exits = captable_.exits();
        investor = investor_;
        token = IERC20(address(captable_.getClass(COMMON).token));
        _shareholders = shareholders_;
    }

    function shareholders() external view returns (address[] memory) {
        return _shareholders;
    }

    function idCount() external view returns (uint256) {
        return ids.length;
    }

    // ---------------------------------------------------------------------------------------------------
    // The Board
    // ---------------------------------------------------------------------------------------------------

    function grantAndIssue(
        uint256 who,
        uint128 amount,
        uint256 startSeed,
        uint256 cliffSeed,
        uint256 endSeed,
        bool x
    )
        external
    {
        address s = _pick(who);
        if (ids.length >= MAX_GRANTS || vesting.grantOf(address(captable), COMMON, s) != 0) return;
        amount = uint128(_bound(amount, 1, 1_000_000));
        if (!_headroom(amount)) return;
        (uint64 start, uint64 cliff, uint64 end) = _schedule(startSeed, cliffSeed, endSeed);
        vm.prank(safe);
        uint256 id = vesting.grantAndIssue(address(captable), COMMON, s, amount, start, cliff, end, x, DOC);
        ids.push(id);
        origin[id] = 1;
        _afterEach();
    }

    /// @dev D4: the Board first issues plain shares, then offers a grant on them.
    function offerGrant(uint256 who, uint128 amount, uint256 startSeed, uint256 cliffSeed, uint256 endSeed) external {
        address s = _pick(who);
        if (ids.length >= MAX_GRANTS) return;
        amount = uint128(_bound(amount, 1, 1_000_000));
        if (!_headroom(amount)) return;
        vm.prank(safe);
        captable.issue(COMMON, s, amount, DOC);
        (uint64 start, uint64 cliff, uint64 end) = _schedule(startSeed, cliffSeed, endSeed);
        vm.prank(safe);
        uint256 id = vesting.offerGrant(
            address(captable), COMMON, s, amount, start, cliff, end, uint64(vm.getBlockTimestamp()) + 30 days, true, DOC
        );
        ids.push(id);
        origin[id] = 2;
        _afterEach();
    }

    function revoke(uint256 idSeed, uint64 delay) external {
        (uint256 id, IVesting.Grant memory g, bool ok) = _live(idSeed);
        if (!ok || g.revokedAt != 0) return;
        uint64 effectiveAt = uint64(vm.getBlockTimestamp()) + uint64(_bound(delay, 0, 365 days));
        if (vesting.lockedOf(address(captable), COMMON, g.shareholder, effectiveAt) == 0) return;
        revokeCalledAt[id] = uint64(vm.getBlockTimestamp());
        vm.prank(safe);
        vesting.revoke(id, effectiveAt);
        _afterEach();
    }

    /// @dev V3: the Board tries to revoke into the past; it must fail (caught, so no handler revert).
    function revokeInPast(uint256 idSeed, uint64 back) external {
        (uint256 id, IVesting.Grant memory g, bool ok) = _live(idSeed);
        uint64 nowTs = uint64(vm.getBlockTimestamp());
        if (!ok || g.revokedAt != 0 || nowTs < 2) return;
        uint64 effectiveAt = nowTs - uint64(_bound(back, 1, nowTs - 1));
        vm.prank(safe);
        try vesting.revoke(id, effectiveAt) {
            v3Breach = true;
        } catch { }
    }

    function accelerate(uint256 idSeed, uint64 newEnd) external {
        (uint256 id, IVesting.Grant memory g, bool ok) = _live(idSeed);
        if (!ok || g.revokedAt != 0 || g.end == 0) return;
        uint64 lo = g.start > 60 days ? g.start - 60 days : 0;
        newEnd = uint64(_bound(newEnd, lo, g.end - 1));
        vm.prank(safe);
        vesting.accelerate(id, newEnd, DOC2);
        _afterEach();
    }

    function accelerateForExit(uint256 idSeed) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        if (lapsed[id]) return;
        vm.prank(exits);
        vesting.accelerateForExit(id);
        _afterEach();
    }

    // ---------------------------------------------------------------------------------------------------
    // Shareholders and anyone
    // ---------------------------------------------------------------------------------------------------

    function acceptGrant(uint256 idSeed) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        if (lapsed[id]) return;
        IVesting.Grant memory g = vesting.getGrant(id);
        if (g.accepted || vm.getBlockTimestamp() > g.offerExpiresAt) return;
        if (vesting.grantOf(address(captable), COMMON, g.shareholder) != 0) return;
        if (token.balanceOf(g.shareholder) < g.amount) return;
        vm.prank(g.shareholder);
        vesting.acceptGrant(id, g.documentHash);
        acceptedBy[id] = g.shareholder;
        _afterEach();
    }

    function settleRevocation(uint256 idSeed, uint256 caller) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        if (lapsed[id]) return;
        IVesting.Grant memory g = vesting.getGrant(id);
        if (g.revokedAt == 0 || vm.getBlockTimestamp() < g.revokedAt) return;
        vm.prank(_pick(caller));
        vesting.settleRevocation(id);
        _afterEach();
    }

    function release(uint256 idSeed) external {
        (uint256 id, IVesting.Grant memory g, bool ok) = _live(idSeed);
        if (!ok) return;
        bool done = g.revokedAt == 0 ? vm.getBlockTimestamp() >= g.end : g.burned > 0;
        if (!done) return;
        vesting.release(id);
        _afterEach();
    }

    function lapse(uint256 idSeed) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        if (lapsed[id]) return;
        IVesting.Grant memory g = vesting.getGrant(id);
        if (g.accepted || vm.getBlockTimestamp() <= g.offerExpiresAt) return;
        vesting.lapse(id);
        lapsed[id] = true;
        _afterEach();
    }

    /// @dev V5: the investor gives shares; the receiver's locked amount must not fall.
    function transferIn(uint256 to, uint256 amount) external {
        address s = _pick(to);
        uint256 have = token.balanceOf(investor);
        if (have == 0) return;
        amount = _bound(amount, 1, have);
        uint128 before = vesting.lockedOf(address(captable), COMMON, s, uint64(vm.getBlockTimestamp()));
        vm.prank(investor);
        token.transfer(s, amount);
        if (vesting.lockedOf(address(captable), COMMON, s, uint64(vm.getBlockTimestamp())) < before) v5Breach = true;
        _afterEach();
    }

    /// @dev V5: the Board issues more plain shares to a shareholder.
    function issueMore(uint256 to, uint128 amount) external {
        address s = _pick(to);
        amount = uint128(_bound(amount, 1, 1_000_000));
        if (!_headroom(amount)) return;
        uint128 before = vesting.lockedOf(address(captable), COMMON, s, uint64(vm.getBlockTimestamp()));
        vm.prank(safe);
        captable.issue(COMMON, s, amount, DOC);
        if (vesting.lockedOf(address(captable), COMMON, s, uint64(vm.getBlockTimestamp())) < before) v5Breach = true;
        _afterEach();
    }

    /// @dev A shareholder moves free shares back to the investor, never into the locked part.
    function transferOut(uint256 from, uint256 amount) external {
        address s = _pick(from);
        uint256 balance = token.balanceOf(s);
        uint128 locked = vesting.lockedOf(address(captable), COMMON, s, uint64(vm.getBlockTimestamp()));
        if (balance <= locked) return;
        amount = _bound(amount, 1, balance - locked);
        vm.prank(s);
        token.transfer(investor, amount);
        _afterEach();
    }

    function warp(uint256 secs) external {
        vm.warp(vm.getBlockTimestamp() + _bound(secs, 1 hours, 60 days));
        _afterEach();
    }

    // ---------------------------------------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------------------------------------

    function _pick(uint256 seed) internal view returns (address) {
        return _shareholders[seed % _shareholders.length];
    }

    function _headroom(uint128 amount) internal view returns (bool) {
        return uint256(captable.issued(COMMON)) + amount <= captable.getClass(COMMON).authorised;
    }

    /// @dev A month-step schedule starting within a year either side of now (never before 2026).
    function _schedule(
        uint256 startSeed,
        uint256 cliffSeed,
        uint256 endSeed
    )
        internal
        view
        returns (uint64 start, uint64 cliff, uint64 end)
    {
        uint256 lo = vm.getBlockTimestamp() > CalendarModel.ANCHOR + 365 days
            ? vm.getBlockTimestamp() - 365 days
            : CalendarModel.ANCHOR;
        start = uint64(_bound(startSeed, lo, vm.getBlockTimestamp() + 365 days));
        uint256 endMonths = _bound(endSeed, 1, 48);
        cliff = uint64(CalendarModel.stepAt(start, _bound(cliffSeed, 0, endMonths)));
        end = uint64(CalendarModel.stepAt(start, endMonths));
    }

    /// @dev A grant that is live: accepted and still the shareholder's grant on the class.
    function _live(uint256 idSeed) internal view returns (uint256 id, IVesting.Grant memory g, bool ok) {
        if (ids.length == 0) return (0, g, false);
        id = ids[idSeed % ids.length];
        if (lapsed[id]) return (id, g, false);
        g = vesting.getGrant(id);
        ok = g.accepted && vesting.grantOf(address(captable), COMMON, g.shareholder) == id;
    }

    /// @dev V1: a live grant's locked amount at now never rises from one step to the next.
    function _afterEach() internal {
        for (uint256 i; i < ids.length; ++i) {
            uint256 id = ids[i];
            if (lapsed[id]) continue;
            IVesting.Grant memory g = vesting.getGrant(id);
            if (!g.accepted || vesting.grantOf(address(captable), COMMON, g.shareholder) != id) continue;
            uint128 l = vesting.lockedOf(address(captable), COMMON, g.shareholder, uint64(vm.getBlockTimestamp()));
            if (seen[id] && l > lastLocked[id]) v1Breach = true;
            seen[id] = true;
            lastLocked[id] = l;
        }
    }
}
