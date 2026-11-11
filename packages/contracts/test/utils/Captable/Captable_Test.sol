// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { Captable } from "../../../src/equity/Captable.sol";
import { ICaptable } from "../../../src/interfaces/ICaptable.sol";
import { Base_Test } from "../../Base.t.sol";
import { MockCaptableGovernor, MockShareClass, MockTransferRule, MockVesting } from "./CaptableMocks.sol";

/// @notice The Captable's shared fixture: a Captable clone of Acme Ltd wired to stand-ins for its
/// neighbours (ShareClass, Governor, Vesting) and initialised with the template's two classes:
///
/// - Common (id 0): weight 1, authorised 10,000,000, no price, deny all.
/// - Series A (id 1): weight 1, authorised 1,000,000, original issue price $2.00, floor $1.00, 1x
///   non-participating, converts into Common. Its reserve in Common is ceil(1,000,000 * 2 / 1) = 2,000,000.
abstract contract Captable_Test is Base_Test {
    string internal constant COMPANY = "Acme";
    uint8 internal constant COMMON = 0;
    uint8 internal constant SERIES_A = 1;
    uint8 internal constant NONE = type(uint8).max;
    uint8 internal constant MAX_CLASSES = 32;
    uint256 internal constant MAX_CLASS_VOTES = 2 ** 200;

    uint128 internal constant COMMON_AUTHORISED = 10_000_000;
    uint128 internal constant SERIES_A_AUTHORISED = 1_000_000;
    uint128 internal constant SERIES_A_OIP = 2e6; // $2.00
    uint128 internal constant SERIES_A_FLOOR = 1e6; // $1.00
    uint256 internal constant SERIES_A_RESERVE = 2_000_000;

    bytes32 internal constant REASON = keccak256("board minute 1");
    bytes32 internal constant SERIES_A_TERMS = keccak256("series a terms");
    /// @dev OpenZeppelin's `ERC5805FutureLookup(uint256 timepoint, uint48 clock)`.
    bytes4 internal constant FUTURE_LOOKUP = bytes4(keccak256("ERC5805FutureLookup(uint256,uint48)"));

    Captable internal captableImpl;
    ICaptable internal captable;
    MockShareClass internal shareClassImpl;
    MockCaptableGovernor internal governor;
    MockCaptableGovernor internal classGovernor;
    MockVesting internal vesting;
    MockTransferRule internal rule;
    address internal options;
    address internal rounds;
    address internal exits;

    function _deployProtocol() internal virtual override {
        shareClassImpl = new MockShareClass();
        captableImpl = new Captable();
        governor = new MockCaptableGovernor();
        classGovernor = new MockCaptableGovernor();
        vesting = new MockVesting();
        rule = new MockTransferRule();
        options = makeAddr("options");
        rounds = makeAddr("rounds");
        exits = makeAddr("exits");
        vm.label(address(governor), "Governor");
        vm.label(address(classGovernor), "Class Governor");
        vm.label(address(vesting), "Vesting");

        captable = ICaptable(Clones.clone(address(captableImpl)));
        vm.label(address(captable), "Captable");
        // On the red stub this reverts NotImplemented, so each test fails on its own first call to the
        // Captable instead of the whole contract failing once in setUp.
        try captable.initialize(COMPANY, _wiring(), _templateClasses()) { } catch { }
    }

    // ------------------------------------------------------------------------------------------------
    // Fixture data
    // ------------------------------------------------------------------------------------------------

    function _wiring() internal view returns (ICaptable.Wiring memory) {
        return ICaptable.Wiring({
            safe: address(safe),
            governor: address(governor),
            vesting: address(vesting),
            options: options,
            rounds: rounds,
            exits: exits,
            shareClassImpl: address(shareClassImpl)
        });
    }

    function _commonParams() internal pure returns (ICaptable.ClassParams memory) {
        return ICaptable.ClassParams({
            name: "Common",
            ticker: "ACME-C",
            weight: 1,
            convertsInto: NONE,
            rule: ICaptable.TransferRule.DenyAll,
            customRule: address(0),
            authorised: COMMON_AUTHORISED,
            originalIssuePrice: 0,
            conversionFloorPrice: 0,
            preferenceMultipleBps: 0,
            participating: false,
            seniority: 1,
            termsHash: keccak256("common terms")
        });
    }

    function _seriesAParams() internal pure returns (ICaptable.ClassParams memory) {
        return ICaptable.ClassParams({
            name: "Series A",
            ticker: "ACME-A",
            weight: 1,
            convertsInto: COMMON,
            rule: ICaptable.TransferRule.DenyAll,
            customRule: address(0),
            authorised: SERIES_A_AUTHORISED,
            originalIssuePrice: SERIES_A_OIP,
            conversionFloorPrice: SERIES_A_FLOOR,
            preferenceMultipleBps: 10_000,
            participating: false,
            seniority: 0,
            termsHash: SERIES_A_TERMS
        });
    }

    function _templateClasses() internal pure returns (ICaptable.ClassParams[] memory classes) {
        classes = new ICaptable.ClassParams[](2);
        classes[0] = _commonParams();
        classes[1] = _seriesAParams();
    }

    /// @dev A standalone class (converts into nothing) with the given weight, authorised and prices.
    function _params(
        uint16 weight,
        uint128 authorised,
        uint128 oip,
        uint128 floor
    )
        internal
        pure
        returns (ICaptable.ClassParams memory p)
    {
        p = _commonParams();
        p.name = "Extra";
        p.ticker = "ACME-X";
        p.weight = weight;
        p.authorised = authorised;
        p.originalIssuePrice = oip;
        p.conversionFloorPrice = floor;
        p.preferenceMultipleBps = oip == 0 ? 0 : 10_000;
    }

    // ------------------------------------------------------------------------------------------------
    // Actions
    // ------------------------------------------------------------------------------------------------

    function _token(uint8 classId) internal view returns (MockShareClass) {
        return MockShareClass(address(captable.getClass(classId).token));
    }

    function _issue(uint8 classId, address to, uint128 amount) internal {
        vm.prank(address(safe));
        captable.issue(classId, to, amount, REASON);
    }

    function _createClass(ICaptable.ClassParams memory p) internal returns (uint8 classId) {
        vm.prank(address(governor));
        classId = captable.createClass(p);
    }

    function _setRule(uint8 classId, ICaptable.TransferRule rule_, address customRule) internal {
        vm.prank(address(governor));
        captable.setTransferRule(classId, rule_, customRule);
    }

    function _lowerPrice(uint8 classId, uint128 price) internal {
        vm.prank(address(governor));
        captable.setConversionPrice(classId, price);
    }

    function _freeze(uint8 classId) internal {
        vm.prank(address(governor));
        captable.freeze(classId);
    }

    function _lock(uint8 classId, address account, uint128 amount) internal {
        vesting.setLocked(address(captable), classId, account, amount);
    }

    function _consentId(
        uint8 classId,
        address from,
        address to,
        uint128 amount,
        bytes32 reason
    )
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(classId, from, to, amount, reason));
    }

    /// @dev One class's term of the vote sum (E3): weight times votes times oip over cp, rounded down once.
    function _classVotes(uint256 weight, uint256 votes, uint256 oip, uint256 cp) internal pure returns (uint256) {
        if (oip == 0) return weight * votes;
        return Math.mulDiv(weight * votes, oip, cp);
    }

    /// @dev Creates standalone voting classes until the company has `count` classes.
    function _fillClassesTo(uint8 count) internal {
        uint8 n = captable.numberOfClasses();
        for (uint8 i = n; i < count; ++i) {
            _createClass(_params(1, 1000, 0, 0));
        }
    }

    function _warp(uint256 dt) internal {
        vm.warp(vm.getBlockTimestamp() + dt);
    }
}
