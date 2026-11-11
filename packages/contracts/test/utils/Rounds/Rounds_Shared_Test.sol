// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { Vm } from "forge-std/Vm.sol";

import { Rounds } from "../../../src/equity/Rounds.sol";
import { IPayments } from "../../../src/interfaces/IPayments.sol";
import { IRounds } from "../../../src/interfaces/IRounds.sol";
import { Base_Test } from "../../Base.t.sol";
import { MockERC20 } from "../../mocks/MockERC20.sol";
import { Payments } from "../../../src/money/Payments.sol";
import { MockCaptableForRounds } from "./MockCaptableForRounds.sol";

/// @notice What every Rounds test shares: a Rounds clone of a sealed implementation, wired to Base_Test's company
/// Safe, a mock Captable and real Payments.
/// @dev The classes follow scenarios/capxul-vectors.json, in price units (6 decimals, USDC units):
/// Common 0; Series Seed 1 at $1.1413 (its class Governor is `seedGovernor`); Series A 2 at $2.5103 (no class
/// Governor); Series C 3 at $2.3724, the round class, so the default priced round is the Series C down round:
/// below Series A's conversion price and above Seed's. Investors approve Rounds for USDC and hold $50M each.
abstract contract Rounds_Shared_Test is Base_Test {
    uint8 internal constant COMMON = 0;
    uint8 internal constant SEED = 1;
    uint8 internal constant SERIES_A = 2;
    uint8 internal constant SERIES_C = 3;

    uint16 internal constant KIND_SHARE_PURCHASE = 5;
    uint16 internal constant KIND_SAFE_PURCHASE = 6;

    uint128 internal constant AUTHORISED = 1_000_000_000;
    uint128 internal constant SEED_PRICE = 1_141_300; // $1.1413
    uint128 internal constant SEED_FLOOR = 100_000; // $0.10
    uint128 internal constant A_PRICE = 2_510_300; // $2.5103
    uint128 internal constant A_FLOOR = 250_000; // $0.25
    uint128 internal constant PRICE = 2_372_400; // $2.3724, Series C

    // The default priced round (Series C) and its investor.
    uint128 internal constant MAX_SHARES = 10_000_000;
    uint64 internal constant PAY_WINDOW = 30 days;
    uint128 internal constant INVITED = 10_000_000 * 1e6; // $10M
    uint128 internal constant SHARES = 4_000_000;
    uint256 internal constant AMOUNT = uint256(SHARES) * PRICE; // $9,489,600 exactly
    bytes32 internal constant ROUND_DOC = keccak256("Series C stock purchase agreement");
    bytes32 internal constant SUBSCRIPTION = keccak256("subscription: investor, Series C");

    // The default SAFE round: the pre-seed SAFEs (a $10M post-money cap, no discount).
    uint128 internal constant CAP = 10_000_000 * 1e6;
    uint16 internal constant DISCOUNT = 0;
    uint64 internal constant SAFE_WINDOW = 60 days;
    uint128 internal constant ANGEL = 250_000 * 1e6;
    uint128 internal constant FUND = 750_000 * 1e6;
    uint256 internal constant CAPITALIZATION = 10_000_000; // shares, as the YC SAFE defines it
    bytes32 internal constant SAFE_FORM = keccak256("YC post-money SAFE, $10M cap");
    bytes32 internal constant ANGEL_SAFE = keccak256("signed SAFE: angel");
    bytes32 internal constant FUND_SAFE = keccak256("signed SAFE: pre-seed fund");

    Rounds internal implementation;
    Rounds internal rounds;
    MockCaptableForRounds internal captable;
    Payments internal payments;
    address internal seedGovernor;
    address internal angel;
    address internal fund;

    function _deployProtocol() internal virtual override {
        seedGovernor = makeAddr("seedGovernor");
        angel = _user("angel");
        fund = _user("fund");
        implementation = new Rounds();
        rounds = Rounds(Clones.clone(address(implementation)));
        captable = new MockCaptableForRounds(address(safe), address(rounds));
        captable.createClass("Common", AUTHORISED, 0, 0, address(0));
        captable.createClass("Series Seed", AUTHORISED, SEED_PRICE, SEED_FLOOR, seedGovernor);
        captable.createClass("Series A", AUTHORISED, A_PRICE, A_FLOOR, address(0));
        captable.createClass("Series C", AUTHORISED, PRICE, PRICE / 10, address(0));
        payments = new Payments();
        vm.label(address(implementation), "Rounds implementation");
        vm.label(address(rounds), "Rounds");
        vm.label(address(captable), "Captable");
        vm.label(address(payments), "Payments");

        // Against the stub this reverts NotImplemented; `try` keeps that failure in each test that uses Rounds
        // instead of the whole contract failing once in setUp.
        try rounds.initialize(address(safe), address(captable), address(payments)) { } catch { }

        address[3] memory investors = [address(users.investor), angel, fund];
        for (uint256 i; i < investors.length; ++i) {
            usdc.mint(investors[i], 50_000_000 * USDC_UNIT);
            vm.prank(investors[i]);
            usdc.approve(address(rounds), type(uint256).max);
        }
        vm.prank(users.eve);
        usdc.approve(address(rounds), type(uint256).max);
    }

    // ---------------------------------------------------------------------------------------------------
    // SAFE rounds
    // ---------------------------------------------------------------------------------------------------

    function _now() internal view returns (uint64) {
        return uint64(vm.getBlockTimestamp());
    }

    function _createSafeRound(uint16 discountBps) internal returns (uint256 id) {
        vm.prank(address(safe));
        id = rounds.createSafeRound(address(usdc), CAP, discountBps, _now() + SAFE_WINDOW, SAFE_FORM);
    }

    function _inviteSafe(uint256 id, address investor, uint128 maxAmount) internal {
        vm.prank(address(safe));
        rounds.inviteSafe(id, investor, maxAmount);
    }

    function _signSafe(uint256 id, address investor, uint128 amount, bytes32 doc) internal returns (uint256 noteId) {
        vm.prank(investor);
        noteId = rounds.signSafe(id, amount, doc);
    }

    /// @dev The pre-seed SAFEs: the angel's $250,000 and the fund's $750,000, both signed.
    function _preSeedNotes(uint16 discountBps) internal returns (uint256 safeId, uint256[] memory noteIds) {
        safeId = _createSafeRound(discountBps);
        _inviteSafe(safeId, angel, ANGEL);
        _inviteSafe(safeId, fund, FUND);
        noteIds = new uint256[](2);
        noteIds[0] = _signSafe(safeId, angel, ANGEL, ANGEL_SAFE);
        noteIds[1] = _signSafe(safeId, fund, FUND, FUND_SAFE);
    }

    function _convert(uint256[] memory noteIds, uint256 pricedId, uint256 capitalization) internal {
        vm.prank(address(safe));
        rounds.convertSafes(noteIds, pricedId, capitalization);
    }

    // ---------------------------------------------------------------------------------------------------
    // Priced rounds
    // ---------------------------------------------------------------------------------------------------

    function _createPricedRound(uint8 classId, uint128 price, uint128 maxShares) internal returns (uint256 id) {
        vm.prank(address(safe));
        id = rounds.createPricedRound(classId, address(usdc), price, maxShares, _now() + PAY_WINDOW, ROUND_DOC);
    }

    function _invite(uint256 id, address investor, uint128 maxAmount) internal {
        vm.prank(address(safe));
        rounds.invite(id, investor, maxAmount);
    }

    function _commit(uint256 id, address investor, uint128 amount) internal {
        vm.prank(investor);
        rounds.commit(id, amount, SUBSCRIPTION);
    }

    /// @dev The Board's allocation batch (spec/rounds.md `allocate`): allocate, and raise the Captable issuer
    /// allowance by the same shares.
    function _allocate(uint256 id, address investor, uint128 shares) internal {
        uint8 classId = rounds.pricedRound(id).classId;
        vm.startPrank(address(safe));
        rounds.allocate(id, investor, shares);
        captable.setIssuerAllowance(
            address(rounds), classId, captable.issuerAllowance(address(rounds), classId) + shares
        );
        vm.stopPrank();
    }

    function _pay(uint256 id, address investor) internal returns (bytes32 paymentId) {
        vm.prank(investor);
        paymentId = rounds.pay(id);
    }

    /// @dev Invited, committed and allocated: `shares` for `investor` in round `id`.
    function _allocated(uint256 id, address investor, uint128 shares) internal {
        _invite(id, investor, INVITED);
        _commit(id, investor, INVITED);
        _allocate(id, investor, shares);
    }

    /// @dev The default Series C round with the investor allocated SHARES, not yet paid.
    function _defaultAllocated() internal returns (uint256 id) {
        id = _createPricedRound(SERIES_C, PRICE, MAX_SHARES);
        _allocated(id, users.investor, SHARES);
    }

    function _close(uint256 id, uint256 a) internal {
        vm.prank(address(safe));
        rounds.close(id, a);
    }

    // ---------------------------------------------------------------------------------------------------
    // The model and checks
    // ---------------------------------------------------------------------------------------------------

    /// @dev spec/rounds.md `convertSafes`, written from the spec.
    function _modelConversionPrice(
        uint128 cap,
        uint256 capitalization,
        uint128 price,
        uint16 discountBps
    )
        internal
        pure
        returns (uint256)
    {
        uint256 capPrice = uint256(cap) / capitalization;
        uint256 discounted = uint256(price) * (10_000 - discountBps) / 10_000;
        return capPrice < discounted ? capPrice : discounted;
    }

    /// @dev spec/rounds.md `close`: `CP2 = CP1 * (A + B) / (A + C)`, `B = moneyRaised / CP1`, rounded down, never
    /// below the floor; unchanged when the round price is not below CP1 or nothing was issued.
    function _modelAntiDilution(
        uint128 cp1,
        uint128 price,
        uint256 a,
        uint256 c,
        uint128 floor
    )
        internal
        pure
        returns (uint128)
    {
        if (price >= cp1 || c == 0) return cp1;
        uint256 b = c * price / cp1;
        uint256 cp2 = Math.mulDiv(cp1, a + b, a + c);
        return cp2 < floor ? floor : uint128(cp2);
    }

    /// @dev Rounds holds nothing after any call.
    function _assertHoldsNothing() internal view {
        assertEq(usdc.balanceOf(address(rounds)), 0, "Rounds holds USDC");
        for (uint8 k; k < captable.numberOfClasses(); ++k) {
            assertEq(captable.token(k).balanceOf(address(rounds)), 0, "Rounds holds shares");
        }
    }

    /// @dev Makes the next call (already pranked by the caller) and checks it reverts `InvalidRound` with any
    /// reason: the reason text is for people, so the tests pin the selector only.
    function _expectInvalidRound(bytes memory data) internal {
        (bool ok, bytes memory reason) = address(rounds).call(data);
        assertFalse(ok, "call should revert");
        assertEq(bytes4(reason), IRounds.InvalidRound.selector, "InvalidRound");
    }

    /// @dev As `_expectInvalidRound`, for an error whose arguments the spec leaves open.
    function _expectSelector(bytes memory data, bytes4 selector) internal {
        (bool ok, bytes memory reason) = address(rounds).call(data);
        assertFalse(ok, "call should revert");
        assertEq(bytes4(reason), selector, "revert selector");
    }

    /// @dev Fails the test if Payments is asked to send or the Captable to issue during the next calls.
    function _expectNoPaymentOrIssue() internal {
        vm.expectCall(address(payments), abi.encodeWithSelector(IPayments.send.selector), 0);
        vm.expectCall(address(captable), abi.encodeWithSelector(MockCaptableForRounds.issue.selector), 0);
    }

    /// @dev The one log of `selector` from Rounds since `vm.recordLogs()`.
    function _oneLog(bytes32 selector) internal returns (Vm.Log memory log) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(rounds) && logs[i].topics[0] == selector) {
                log = logs[i];
                ++found;
            }
        }
        assertEq(found, 1, "one event");
    }

    function _token(uint8 classId) internal view returns (MockERC20) {
        return captable.token(classId);
    }
}
