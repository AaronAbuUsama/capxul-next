// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { Test } from "forge-std/Test.sol";

import { ICaptable } from "../../src/interfaces/ICaptable.sol";
import { MockCaptableGovernor, MockShareClass, MockVesting } from "../utils/Captable/CaptableMocks.sol";

/// @notice Halmos checks for the Captable (gate 10, fv/halmos.md rows E3 and E9). Each check first makes
/// concrete calls that must succeed (the vacuity guard: initialise, issue, read votes), so the reverting stub
/// fails every check.
contract Captable_Symbolic is Test {
    address internal constant SAFE = address(0x5AFE);
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    uint8 internal constant NONE = type(uint8).max;
    uint256 internal constant MAX_CLASS_VOTES = 2 ** 200;
    /// @dev Fixed times, so no check reads `block.timestamp` across a `vm.warp`.
    uint256 internal constant T0 = 1_767_225_600;

    ICaptable internal captable;
    MockCaptableGovernor internal governor;

    function setUp() public {
        vm.warp(T0);
        governor = new MockCaptableGovernor();
        address shareClassImpl = address(new MockShareClass());
        address vesting = address(new MockVesting());
        captable = ICaptable(Clones.clone(_deployImplementation()));
        _wiring = ICaptable.Wiring({
            safe: SAFE,
            governor: address(governor),
            vesting: vesting,
            options: address(0x0971),
            rounds: address(0x2047),
            exits: address(0xE817),
            shareClassImpl: shareClassImpl
        });
    }

    ICaptable.Wiring internal _wiring;

    /// @dev Foundry's dynamic test linking compiles `new Captable()` in a test into `vm.deployCode`, which
    /// Halmos 0.3.3 does not support; the artifact's creation code deployed by hand works in both.
    function _deployImplementation() internal returns (address implementation) {
        bytes memory code = vm.getCode("Captable.sol:Captable");
        assembly ("memory-safe") {
            implementation := create(0, add(code, 0x20), mload(code))
        }
        assert(implementation != address(0));
    }

    function _class(
        uint16 weight,
        uint128 authorised,
        uint128 oip,
        uint128 floor
    )
        internal
        pure
        returns (ICaptable.ClassParams memory p)
    {
        p.name = "Class";
        p.ticker = "CLS";
        p.weight = weight;
        p.convertsInto = NONE;
        p.authorised = authorised;
        p.originalIssuePrice = oip;
        p.conversionFloorPrice = floor;
        p.preferenceMultipleBps = oip == 0 ? 0 : 10_000;
        p.termsHash = keccak256("terms");
    }

    /// @dev The vacuity guard: a Common class of 1,000, 10 shares to Alice, 10 votes one second later.
    function _guard() internal {
        ICaptable.ClassParams[] memory classes = new ICaptable.ClassParams[](1);
        classes[0] = _class(1, 1000, 0, 0);
        try captable.initialize("Acme", _wiring, classes) { }
        catch {
            assert(false);
        }
        vm.prank(SAFE);
        try captable.issue(0, ALICE, 10, keccak256("guard")) { }
        catch {
            assert(false);
        }
        vm.warp(T0 + 1);
        try captable.getPastVotes(ALICE, T0) returns (uint256 votes) {
            assert(votes == 10);
        } catch {
            assert(false);
        }
    }

    /// @dev E3 (per class): a class's votes are floor(weight * shares * oip / cp) exactly, and the read never
    /// reverts, for every weight and every `uint96` share count.
    /// J13: Math.mulDiv's 512-bit `mulmod` of a symbolic numerator by a price with many set bits (2e6, even with
    /// every price concrete) does not finish in Halmos 0.3.3 with yices, so the prices are drawn from four concrete
    /// (oip, floor, cp) triples with few set bits: ratio 1 without a price (Common) and with one, and the
    /// rounding ratios 3/2 and 8/3. Weight and shares stay fully symbolic. The full range (every weight, every
    /// `uint128` price, every share count the vote bound admits, the same bracket in 512 bits) is the fuzz
    /// `testFuzz_GetPastVotes_Formula` (test/unit/fuzz/Captable/getPastVotes.t.sol).
    function check_E3_classVotes(uint16 weight, uint96 shares, uint8 priceSel) public {
        _guard();
        vm.assume(shares > 0 && priceSel < 4);
        (uint128 oip, uint128 floor, uint128 cp) = _e3Prices(priceSel);

        vm.prank(address(governor));
        uint8 id = captable.createClass(_class(weight, shares, oip, floor));
        vm.prank(SAFE);
        captable.issue(id, BOB, shares, keccak256("issue"));
        if (cp < oip) {
            vm.prank(address(governor));
            captable.setConversionPrice(id, cp);
        }
        vm.warp(T0 + 2);

        uint256 votes = captable.getPastVotes(BOB, T0 + 1);
        uint256 exact = uint256(weight) * shares * (oip == 0 ? 1 : oip); // the numerator, below 2^116
        uint256 divisor = oip == 0 ? 1 : cp; // a class with no issue price has ratio 1
        assert(votes * divisor <= exact);
        assert(exact < (votes + 1) * divisor);
    }

    /// @dev The (oip, floor, cp) triples of `check_E3_classVotes`.
    function _e3Prices(uint8 sel) internal pure returns (uint128 oip, uint128 floor, uint128 cp) {
        if (sel == 0) return (0, 0, 0); // Common: no price, ratio 1
        if (sel == 1) return (2, 1, 2); // priced, never lowered: ratio 1 through mulDiv
        if (sel == 2) return (3, 1, 2);
        return (8, 1, 3);
    }

    /// @dev E9 (bound, N-4): createClass accepts terms exactly when floor(weight * authorised * oip / floor)
    /// is at most 2^200, and refuses the rest with VotesBoundExceeded, for every weight and every `uint128`
    /// authorised amount.
    /// J13: as in E3, the (oip, floor) pairs are concrete with few set bits, chosen so the bound is reached
    /// within uint128 authorised: no price; ratio 1; 2^60; 3 * 2^60; and 5 * 2^58 / 3 (rounded at the bound).
    /// The full range of every term is the fuzz `testFuzz_CreateClass_VoteBound`, and the exact edge for any
    /// price pair is `testFuzz_CreateClass_VoteBoundEdge` (test/unit/fuzz/Captable/createClass.t.sol).
    function check_E9_voteBound(uint16 weight, uint128 authorised, uint8 priceSel) public {
        _guard();
        vm.assume(authorised > 0 && priceSel < 5);
        (uint128 oip, uint128 floor) = _e9Prices(priceSel);
        uint256 numerator = uint256(weight) * authorised * oip; // below 2^206
        // floor(n / f) <= 2^200; a class with no issue price is always within (below 2^144).
        bool within = oip == 0 || numerator < (MAX_CLASS_VOTES + 1) * floor;

        vm.prank(address(governor));
        try captable.createClass(_class(weight, authorised, oip, floor)) returns (uint8 id) {
            assert(within);
            assert(captable.getClass(id).authorised == authorised);
        } catch (bytes memory reason) {
            assert(!within);
            assert(bytes4(reason) == ICaptable.VotesBoundExceeded.selector);
        }
    }

    /// @dev The (oip, floor) pairs of `check_E9_voteBound`.
    function _e9Prices(uint8 sel) internal pure returns (uint128 oip, uint128 floor) {
        if (sel == 0) return (0, 0); // no price: ratio 1, always within
        if (sel == 1) return (1, 1);
        if (sel == 2) return (2 ** 60, 1);
        if (sel == 3) return (3 * 2 ** 60, 1);
        return (5 * 2 ** 58, 3);
    }

    /// @dev E9 (sum): with at most 32 classes each at most 2^200, the company sum cannot overflow 256 bits.
    /// @custom:halmos --loop 33
    function check_E9_sumFits(uint256[32] memory classMax) public {
        _guard();
        assert(captable.MAX_CLASS_VOTES() == MAX_CLASS_VOTES);
        assert(captable.MAX_CLASSES() == 32);
        uint256 sum;
        for (uint256 i; i < 32; ++i) {
            vm.assume(classMax[i] <= MAX_CLASS_VOTES);
            unchecked {
                sum += classMax[i];
            }
            assert(sum >= classMax[i]);
        }
        assert(sum <= 32 * MAX_CLASS_VOTES);
    }
}
