// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Vm } from "forge-std/Vm.sol";

import { Vesting } from "../../../src/equity/Vesting.sol";
import { ICaptable } from "../../../src/interfaces/ICaptable.sol";
import { IShareClass } from "../../../src/interfaces/IShareClass.sol";
import { IVesting } from "../../../src/interfaces/IVesting.sol";
import { Base_Test } from "../../Base.t.sol";
import { CalendarModel } from "../Calendar/CalendarModel.sol";
import { MockCaptableForVesting } from "./MockCaptableForVesting.sol";

/// @notice What every Vesting test shares: the shared Vesting contract, a mock Captable (two classes, Common 0
/// and Preferred 1) whose Board is Base_Test's company Safe and whose Exits is a named address, Vesting's issuer
/// allowance on both classes, the standard founder schedule and the tests' own model of the curve.
/// @dev The standard grant (spec/vesting.md, startup story M6): 4,800,000 shares from 1 January 2026, a
/// one-year cliff on 1 January 2027 and the end on 1 January 2030 (48 months), so 100,000 shares unlock on
/// each month step from the cliff. The model uses `CalendarModel.monthsBetween`, never the Calendar library.
abstract contract Vesting_Shared_Test is Base_Test {
    uint8 internal constant COMMON = 0;
    uint8 internal constant PREFERRED = 1;
    uint128 internal constant AUTHORISED = 100_000_000;
    uint128 internal constant AMOUNT = 4_800_000;
    bytes32 internal constant DOC = keccak256("founder vesting agreement");
    bytes32 internal constant DOC2 = keccak256("board resolution: accelerate");
    uint64 internal constant OFFER_WINDOW = 30 days;

    Vesting internal vesting;
    MockCaptableForVesting internal captable;
    address internal exits;
    /// @dev The Common class token, read once: reading it between `vm.prank` and a call would use the prank.
    IShareClass internal common;

    uint64 internal gStart; // 2026-01-01
    uint64 internal gCliff; // 2027-01-01
    uint64 internal gEnd; // 2030-01-01

    function _deployProtocol() internal virtual override {
        vesting = new Vesting();
        exits = makeAddr("exits");
        captable = new MockCaptableForVesting(address(safe), exits, address(vesting));
        captable.createClass(AUTHORISED);
        captable.createClass(AUTHORISED);
        vm.startPrank(address(safe));
        captable.setIssuerAllowance(address(vesting), COMMON, AUTHORISED);
        captable.setIssuerAllowance(address(vesting), PREFERRED, AUTHORISED);
        vm.stopPrank();
        common = captable.getClass(COMMON).token;
        vm.label(address(vesting), "Vesting");
        vm.label(address(captable), "Captable");
        gStart = uint64(START);
        gCliff = _date(2027, 1, 1);
        gEnd = _date(2030, 1, 1);
    }

    // ---------------------------------------------------------------------------------------------------
    // Actions
    // ---------------------------------------------------------------------------------------------------

    function _grant(
        address shareholder,
        uint128 amount,
        uint64 start,
        uint64 cliff,
        uint64 end,
        bool onExit
    )
        internal
        returns (uint256 id)
    {
        vm.prank(address(safe));
        id = vesting.grantAndIssue(address(captable), COMMON, shareholder, amount, start, cliff, end, onExit, DOC);
    }

    /// @dev The standard grant, accelerating on exit.
    function _defaultGrant(address shareholder) internal returns (uint256) {
        return _grant(shareholder, AMOUNT, gStart, gCliff, gEnd, true);
    }

    /// @dev The Board issues plain (unvested) shares of Common.
    function _issue(address to, uint128 amount) internal {
        vm.prank(address(safe));
        captable.issue(COMMON, to, amount, DOC);
    }

    /// @dev The standard schedule offered on `amount` Common shares the shareholder already holds (D4).
    function _offer(address shareholder, uint128 amount) internal returns (uint256 id) {
        vm.prank(address(safe));
        id = vesting.offerGrant(
            address(captable),
            COMMON,
            shareholder,
            amount,
            gStart,
            gCliff,
            gEnd,
            uint64(block.timestamp) + OFFER_WINDOW,
            true,
            DOC
        );
    }

    function _revoke(uint256 id, uint64 effectiveAt) internal {
        vm.prank(address(safe));
        vesting.revoke(id, effectiveAt);
    }

    function _accelerate(uint256 id, uint64 newEnd, bytes32 doc) internal {
        vm.prank(address(safe));
        vesting.accelerate(id, newEnd, doc);
    }

    // ---------------------------------------------------------------------------------------------------
    // Reads and the model
    // ---------------------------------------------------------------------------------------------------

    function _token(uint8 classId) internal view returns (IShareClass) {
        return captable.getClass(classId).token;
    }

    function _balance(address who) internal view returns (uint256) {
        return IERC20(address(_token(COMMON))).balanceOf(who);
    }

    function _locked(address who, uint64 t) internal view returns (uint128) {
        return vesting.lockedOf(address(captable), COMMON, who, t);
    }

    function _now() internal view returns (uint64) {
        return uint64(vm.getBlockTimestamp());
    }

    function _date(uint256 y, uint256 m, uint256 d) internal pure returns (uint64) {
        return uint64(CalendarModel.date(y, m, d));
    }

    /// @dev spec/vesting.md "The schedule", written from the spec: whole calendar months, locked rounds up.
    function _model(uint128 amount, uint64 start, uint64 cliff, uint64 end, uint64 t) internal pure returns (uint128) {
        if (t < cliff) return amount;
        if (t >= end) return 0;
        uint256 total = CalendarModel.monthsBetween(start, end);
        uint256 done = CalendarModel.monthsBetween(start, t);
        return uint128(amount - uint256(amount) * done / total);
    }

    /// @dev A valid schedule for fuzzing: a start in 2026 to 2028, 1 to 72 whole months, a cliff on a month step.
    function _boundSchedule(
        uint256 startSeed,
        uint256 cliffSeed,
        uint256 endSeed
    )
        internal
        pure
        returns (uint64 start, uint64 cliff, uint64 end)
    {
        start = uint64(_bound(startSeed, START, START + 3 * 365 days));
        uint256 endMonths = _bound(endSeed, 1, 72);
        cliff = uint64(CalendarModel.stepAt(start, _bound(cliffSeed, 0, endMonths)));
        end = uint64(CalendarModel.stepAt(start, endMonths));
    }

    /// @dev Whether a schedule passes spec/vesting.md's checks (amount aside).
    function _validSchedule(uint64 start, uint64 cliff, uint64 end) internal pure returns (bool) {
        if (start > cliff || cliff > end) return false;
        return cliff == end || CalendarModel.monthsBetween(start, end) >= 1;
    }

    /// @dev The grant as `grantAndIssue` must store it.
    function _liveGrant(
        address shareholder,
        uint128 amount,
        uint64 start,
        uint64 cliff,
        uint64 end,
        bool onExit
    )
        internal
        view
        returns (IVesting.Grant memory)
    {
        return IVesting.Grant({
            captable: address(captable),
            classId: COMMON,
            shareholder: shareholder,
            amount: amount,
            start: start,
            cliff: cliff,
            end: end,
            offerExpiresAt: 0,
            revokedAt: 0,
            burned: 0,
            accepted: true,
            accelerateOnExit: onExit,
            documentHash: DOC
        });
    }

    function _grantHash(uint256 id) internal view returns (bytes32) {
        return keccak256(abi.encode(vesting.getGrant(id)));
    }

    function _assertGrant(IVesting.Grant memory a, IVesting.Grant memory b) internal pure {
        assertEq(keccak256(abi.encode(a)), keccak256(abi.encode(b)), "grant");
    }

    /// @dev Fails the test if the Captable is asked to issue or burn during the next calls.
    function _expectNoIssueOrBurn() internal {
        vm.expectCall(address(captable), abi.encodeWithSelector(ICaptable.issue.selector), 0);
        vm.expectCall(address(captable), abi.encodeWithSelector(ICaptable.burnUnvested.selector), 0);
    }

    /// @dev Asserts that the logs recorded since `vm.recordLogs()` hold no event from Vesting.
    function _assertNoVestingEvent() internal {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            assertTrue(logs[i].emitter != address(vesting), "Vesting emitted an event");
        }
    }
}
