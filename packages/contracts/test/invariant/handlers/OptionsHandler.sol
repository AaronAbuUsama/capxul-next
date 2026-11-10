// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";

import { IOptions } from "../../../src/interfaces/IOptions.sol";
import { MockERC20 } from "../../mocks/MockERC20.sol";
import { CalendarModel } from "../../utils/Calendar/CalendarModel.sol";
import { MockCaptableForOptions } from "../../utils/Options/MockCaptableForOptions.sol";

/// @notice The honest actors of Options.invariant.t.sol (fv/halmos.md "Handlers": setPool, grant, accept,
/// exercise, end, lapse, warp; plus Exits' endAllForExit). The Board (the company Safe) sets the pool with the
/// same issuer allowance in one batch, grants and ends; the grantees (Amira's engineers Alice, Bob and Jordan)
/// accept and exercise; anyone lapses; Exits rarely ends every grant. Every input is bounded so each call must succeed (`fail_on_revert`), and the handler keeps its own
/// model of `allocated` and of the strike paid, written from spec/options.md, never read back from Options.
contract OptionsHandler is Test {
    uint8 internal constant COMMON = 0;
    bytes32 internal constant DOC = keccak256("option agreement");
    uint128 internal constant STRIKE = 50_000;

    IOptions internal immutable options;
    MockCaptableForOptions internal immutable captable;
    MockERC20 internal immutable usdc;
    address internal immutable safe;
    address[] internal grantees;

    uint256[] public ids;
    uint128 public ghostAllocated;
    uint128 public ghostExercised;
    uint256 public ghostStrikePaid;
    mapping(bytes32 fn => uint256) public calls;

    constructor(
        IOptions options_,
        MockCaptableForOptions captable_,
        MockERC20 usdc_,
        address safe_,
        address[] memory g
    ) {
        options = options_;
        captable = captable_;
        usdc = usdc_;
        safe = safe_;
        grantees = g;
    }

    function idsLength() external view returns (uint256) {
        return ids.length;
    }

    // ---------------------------------------------------------------------------------------------------
    // The Board
    // ---------------------------------------------------------------------------------------------------

    function setPool(uint128 amount) external {
        uint256 headroom = captable.authorised(COMMON) - captable.issued(COMMON);
        uint128 lo = options.allocated();
        if (headroom < lo) return;
        amount = uint128(bound(amount, lo, headroom < uint256(lo) + 2_000_000 ? headroom : uint256(lo) + 2_000_000));
        vm.startPrank(safe);
        options.setPool(amount);
        captable.setIssuerAllowance(address(options), COMMON, amount);
        vm.stopPrank();
        calls["setPool"]++;
    }

    function grant(uint256 seed, uint128 shares, uint256 months, uint256 cliffMonths, uint32 windowDays) external {
        uint128 left = options.pool() - options.allocated();
        if (left == 0) return;
        shares = uint128(bound(shares, 1, left));
        uint64[3] memory d = _dates(bound(months, 1, 48), cliffMonths);
        vm.prank(safe);
        uint256 id = options.grant(
            grantees[bound(seed, 0, grantees.length - 1)],
            shares,
            address(usdc),
            STRIKE,
            d[0],
            d[1],
            d[2],
            d[0] + 30 days,
            d[2] + 365 days,
            uint32(bound(windowDays, 0, 90)),
            DOC
        );
        ids.push(id);
        ghostAllocated += shares;
        calls["grant"]++;
    }

    /// @dev start (now), cliff and end on whole-month steps from now.
    function _dates(uint256 months, uint256 cliffMonths) internal view returns (uint64[3] memory d) {
        d[0] = uint64(block.timestamp);
        d[1] = uint64(CalendarModel.stepAt(d[0], bound(cliffMonths, 0, months)));
        d[2] = uint64(CalendarModel.stepAt(d[0], months));
    }

    function end(uint256 seed, uint64 dt) external {
        if (ids.length == 0) return;
        uint256 id = ids[bound(seed, 0, ids.length - 1)];
        IOptions.OptionGrant memory g = options.getGrant(id);
        if (!g.accepted || g.cancelled || g.endedAt != 0) return;
        uint64 endedAt = uint64(block.timestamp + bound(dt, 0, 365 days));
        vm.prank(safe);
        options.end(id, endedAt);
        ghostAllocated -= g.shares - model(g, endedAt);
        calls["end"]++;
    }

    // ---------------------------------------------------------------------------------------------------
    // The grantees and anyone
    // ---------------------------------------------------------------------------------------------------

    function accept(uint256 seed) external {
        if (ids.length == 0) return;
        uint256 id = ids[bound(seed, 0, ids.length - 1)];
        IOptions.OptionGrant memory g = options.getGrant(id);
        if (g.accepted || g.cancelled || block.timestamp > g.offerExpiresAt) return;
        vm.prank(g.grantee);
        options.accept(id, DOC);
        calls["accept"]++;
    }

    function exercise(uint256 seed, uint128 n) external {
        if (ids.length == 0) return;
        uint256 id = ids[bound(seed, 0, ids.length - 1)];
        IOptions.OptionGrant memory g = options.getGrant(id);
        if (!g.accepted || g.cancelled || block.timestamp > g.expiresAt) return;
        if (g.endedAt != 0 && block.timestamp > uint256(g.endedAt) + uint256(g.exerciseWindowDays) * 1 days) return;
        uint128 vested = model(g, uint64(block.timestamp));
        if (vested <= g.exercised) return;
        n = uint128(bound(n, 1, vested - g.exercised));
        uint256 owed = uint256(n) * g.strikePrice;
        usdc.mint(g.grantee, owed);
        vm.prank(g.grantee);
        options.exercise(id, n);
        ghostAllocated -= n;
        ghostExercised += n;
        ghostStrikePaid += owed;
        calls["exercise"]++;
    }

    function lapse(uint256 seed) external {
        if (ids.length == 0) return;
        uint256 id = ids[bound(seed, 0, ids.length - 1)];
        IOptions.OptionGrant memory g = options.getGrant(id);
        if (g.cancelled) return;
        bool offerGone = !g.accepted && block.timestamp > g.offerExpiresAt;
        bool expired = g.accepted && block.timestamp > g.expiresAt;
        bool windowShut = g.accepted && g.endedAt != 0
            && block.timestamp > uint256(g.endedAt) + uint256(g.exerciseWindowDays) * 1 days;
        if (!offerGone && !expired && !windowShut) return;
        options.lapse(id);
        ghostAllocated -= (g.endedAt != 0 ? model(g, g.endedAt) : g.shares) - g.exercised;
        calls["lapse"]++;
    }

    /// @dev Exits ends every grant at a settled sale (rarely, so most runs also grant and exercise after it; a
    /// later call ends the grants made since, at its own time). Nothing stays allocated.
    function endAllForExit(uint256 seed) external {
        if (seed % 25 != 0) return;
        vm.prank(captable.exits());
        options.endAllForExit();
        ghostAllocated = 0;
        calls["endAllForExit"]++;
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 1 hours, 120 days));
        calls["warp"]++;
    }

    // ---------------------------------------------------------------------------------------------------
    // The model (spec/options.md `vestedOf`, Vesting's calendar-month formula)
    // ---------------------------------------------------------------------------------------------------

    function model(IOptions.OptionGrant memory g, uint64 t) public pure returns (uint128) {
        if (g.endedAt != 0 && t > g.endedAt) t = g.endedAt;
        if (t < g.cliff) return 0;
        if (t >= g.end) return g.shares;
        return uint128(
            uint256(g.shares) * CalendarModel.monthsBetween(g.start, t) / CalendarModel.monthsBetween(g.start, g.end)
        );
    }
}
