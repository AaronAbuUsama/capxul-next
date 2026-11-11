// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { Vm } from "forge-std/Vm.sol";

import { Options } from "../../../src/equity/Options.sol";
import { IOptions } from "../../../src/interfaces/IOptions.sol";
import { IPayments } from "../../../src/interfaces/IPayments.sol";
import { Base_Test } from "../../Base.t.sol";
import { MockERC20 } from "../../mocks/MockERC20.sol";
import { CalendarModel } from "../Calendar/CalendarModel.sol";
import { Payments } from "../../../src/money/Payments.sol";
import { MockCaptableForOptions } from "./MockCaptableForOptions.sol";

/// @notice What every Options test shares: an Options clone of a sealed implementation, wired to Base_Test's
/// company Safe, a mock Captable (one class, Common 0, whose Exits is a named address) and real Payments.
/// The Board sets a pool of 1,000,000 Common options and the same issuer
/// allowance; Alice (the engineer) is the grantee and has approved Options for her USDC.
/// @dev The standard grant (scenarios/capxul-vectors.json, first option grants; slices/W4.md leaver numbers):
/// 150,000 options at $0.05 (50,000 USDC units) from 1 January 2026, a one-year cliff on 1 January 2027 and
/// the end on 1 January 2030 (48 months), so 3,125 options vest on each month step from the cliff. After 36
/// of 48 months 112,500 have vested and their strike is $5,625. The model uses `CalendarModel.monthsBetween`,
/// never the Calendar library.
abstract contract Options_Shared_Test is Base_Test {
    uint8 internal constant COMMON = 0;
    uint16 internal constant KIND_OPTION_EXERCISE = 7;
    uint128 internal constant AUTHORISED = 100_000_000;
    uint128 internal constant POOL = 1_000_000;
    uint128 internal constant SHARES = 150_000;
    uint128 internal constant STRIKE = 50_000; // $0.05 in USDC units
    uint32 internal constant WINDOW_DAYS = 90;
    uint64 internal constant OFFER_WINDOW = 30 days;
    bytes32 internal constant DOC = keccak256("option agreement: Alice, 150,000 Common at $0.05");

    Options internal implementation;
    Options internal options;
    MockCaptableForOptions internal captable;
    Payments internal payments;
    MockERC20 internal common;
    address internal exits;

    uint64 internal gStart; // 2026-01-01
    uint64 internal gCliff; // 2027-01-01
    uint64 internal gEnd; // 2030-01-01
    uint64 internal gExpires; // 2036-01-01

    function _deployProtocol() internal virtual override {
        exits = makeAddr("exits");
        implementation = new Options();
        options = Options(Clones.clone(address(implementation)));
        captable = new MockCaptableForOptions(address(safe), exits);
        captable.createClass(AUTHORISED);
        common = captable.token(COMMON);
        payments = new Payments();
        vm.label(address(implementation), "Options implementation");
        vm.label(address(options), "Options");
        vm.label(address(captable), "Captable");
        vm.label(address(payments), "Payments");
        vm.label(address(common), "Common");

        gStart = uint64(START);
        gCliff = _date(2027, 1, 1);
        gEnd = _date(2030, 1, 1);
        gExpires = _date(2036, 1, 1);

        // Against the stub these revert NotImplemented; `try` keeps that failure in each test that uses Options
        // instead of the whole contract failing once in setUp.
        try options.initialize(address(safe), address(captable), address(payments), COMMON) { } catch { }
        vm.startPrank(address(safe));
        captable.setIssuerAllowance(address(options), COMMON, POOL);
        try options.setPool(POOL) { } catch { }
        vm.stopPrank();

        vm.prank(users.alice);
        usdc.approve(address(options), type(uint256).max);
        vm.prank(users.bob);
        usdc.approve(address(options), type(uint256).max);
    }

    // ---------------------------------------------------------------------------------------------------
    // Actions
    // ---------------------------------------------------------------------------------------------------

    function _setPool(uint128 amount) internal {
        vm.prank(address(safe));
        options.setPool(amount);
    }

    function _grant(
        address grantee,
        uint128 shares,
        uint64 start,
        uint64 cliff,
        uint64 end,
        uint64 expiresAt
    )
        internal
        returns (uint256 id)
    {
        vm.prank(address(safe));
        id = options.grant(
            grantee,
            shares,
            address(usdc),
            STRIKE,
            start,
            cliff,
            end,
            _now() + OFFER_WINDOW,
            expiresAt,
            WINDOW_DAYS,
            DOC
        );
    }

    /// @dev The standard grant to Alice, offered and not yet accepted.
    function _defaultGrant() internal returns (uint256) {
        return _grant(users.alice, SHARES, gStart, gCliff, gEnd, gExpires);
    }

    function _accept(uint256 id) internal {
        vm.prank(options.getGrant(id).grantee);
        options.accept(id, DOC);
    }

    /// @dev The standard grant, accepted by Alice.
    function _acceptedGrant() internal returns (uint256 id) {
        id = _defaultGrant();
        _accept(id);
    }

    function _exercise(uint256 id, uint128 shares) internal {
        vm.prank(options.getGrant(id).grantee);
        options.exercise(id, shares);
    }

    function _end(uint256 id, uint64 endedAt) internal {
        vm.prank(address(safe));
        options.end(id, endedAt);
    }

    // ---------------------------------------------------------------------------------------------------
    // Reads and the model
    // ---------------------------------------------------------------------------------------------------

    function _now() internal view returns (uint64) {
        return uint64(vm.getBlockTimestamp());
    }

    function _date(uint256 y, uint256 m, uint256 d) internal pure returns (uint64) {
        return uint64(CalendarModel.date(y, m, d));
    }

    /// @dev spec/options.md `vestedOf`, written from the spec: Vesting's calendar-month formula (spec/vesting.md
    /// "The schedule"), vested rounds down, frozen at `endedAt` when the grant was ended.
    function _model(
        uint128 shares,
        uint64 start,
        uint64 cliff,
        uint64 end,
        uint64 endedAt,
        uint64 t
    )
        internal
        pure
        returns (uint128)
    {
        if (endedAt != 0 && t > endedAt) t = endedAt;
        if (t < cliff) return 0;
        if (t >= end) return shares;
        return
            uint128(uint256(shares) * CalendarModel.monthsBetween(start, t) / CalendarModel.monthsBetween(start, end));
    }

    /// @dev Whether a schedule passes spec/options.md's checks: as Vesting, and `expiresAt > end`.
    function _validSchedule(uint64 start, uint64 cliff, uint64 end, uint64 expiresAt) internal pure returns (bool) {
        if (start > cliff || cliff > end || expiresAt <= end) return false;
        return cliff == end || CalendarModel.monthsBetween(start, end) >= 1;
    }

    /// @dev The grant as `grant` must store it.
    function _offered(
        address grantee,
        uint128 shares,
        uint64 start,
        uint64 cliff,
        uint64 end,
        uint64 offerExpiresAt,
        uint64 expiresAt
    )
        internal
        view
        returns (IOptions.OptionGrant memory)
    {
        return IOptions.OptionGrant({
            grantee: grantee,
            shares: shares,
            exercised: 0,
            strikeToken: address(usdc),
            strikePrice: STRIKE,
            start: start,
            cliff: cliff,
            end: end,
            offerExpiresAt: offerExpiresAt,
            expiresAt: expiresAt,
            endedAt: 0,
            exerciseWindowDays: WINDOW_DAYS,
            accepted: false,
            cancelled: false,
            documentHash: DOC
        });
    }

    function _assertGrant(IOptions.OptionGrant memory a, IOptions.OptionGrant memory b) internal pure {
        assertEq(keccak256(abi.encode(a)), keccak256(abi.encode(b)), "grant");
    }

    function _grantHash(uint256 id) internal view returns (bytes32) {
        return keccak256(abi.encode(options.getGrant(id)));
    }

    /// @dev Options holds nothing after any call: no strike token and no shares.
    function _assertHoldsNothing() internal view {
        assertEq(usdc.balanceOf(address(options)), 0, "Options holds USDC");
        assertEq(common.balanceOf(address(options)), 0, "Options holds shares");
    }

    /// @dev The one `Exercised` event in the logs recorded since `vm.recordLogs()`.
    function _exercisedLog() internal returns (uint256 id, uint128 shares, uint256 paid, bytes32 paymentId) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(options) && logs[i].topics[0] == IOptions.Exercised.selector) {
                id = uint256(logs[i].topics[1]);
                (shares, paid, paymentId) = abi.decode(logs[i].data, (uint128, uint256, bytes32));
                ++found;
            }
        }
        assertEq(found, 1, "one Exercised event");
    }

    /// @dev Fails the test if Payments is asked to send or the Captable to issue during the next calls.
    function _expectNoPaymentOrIssue() internal {
        vm.expectCall(address(payments), abi.encodeWithSelector(IPayments.send.selector), 0);
        vm.expectCall(address(captable), abi.encodeWithSelector(MockCaptableForOptions.issue.selector), 0);
    }
}
