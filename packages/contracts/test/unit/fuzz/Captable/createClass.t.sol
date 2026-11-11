// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { ICaptable } from "../../../../src/interfaces/ICaptable.sol";
import { Captable_Test } from "../../../utils/Captable/Captable_Test.sol";

/// @dev N-4 (E9): createClass refuses exactly the terms whose weighted as-converted maximum,
/// mulDiv(weight * authorised, oip, floor), is above 2^200.
contract CreateClass_Captable_Unit_Fuzz_Test is Captable_Test {
    function testFuzz_CreateClass_VoteBound(uint16 weight, uint128 authorised, uint128 oip, uint128 floor) external {
        authorised = uint128(bound(authorised, 1, type(uint128).max));
        oip = uint128(bound(oip, 1, type(uint128).max));
        floor = uint128(bound(floor, 1, oip));
        // A result above 2^256 is above the bound too; Math.mulDiv would panic on it.
        (uint256 high,) = Math.mul512(uint256(weight) * authorised, oip);
        uint256 maxVotes = high >= floor ? type(uint256).max : Math.mulDiv(uint256(weight) * authorised, oip, floor);

        vm.prank(address(governor));
        if (maxVotes > MAX_CLASS_VOTES) {
            vm.expectRevert(abi.encodeWithSelector(ICaptable.VotesBoundExceeded.selector, uint8(2)));
            captable.createClass(_params(weight, authorised, oip, floor));
        } else {
            uint8 id = captable.createClass(_params(weight, authorised, oip, floor));
            assertEq(id, 2, "created");
            assertEq(captable.getClass(id).authorised, authorised, "stored");
        }
    }

    /// @dev The vote bound at its edge, for any weight and any price pair whose edge lies within `uint128`
    /// authorised (Halmos `check_E9_voteBound` runs on concrete prices under J13; this covers the rest). The
    /// largest admitted amount is the largest `a` with weight * a * oip < (2^200 + 1) * floor, derived here
    /// without the contract's own formula: `a` is accepted and `a + 1` is refused.
    function testFuzz_CreateClass_VoteBoundEdge(uint16 weight, uint128 oip, uint128 floor) external {
        weight = uint16(bound(weight, 1, type(uint16).max));
        oip = uint128(bound(oip, 2 ** 72, type(uint128).max));
        floor = uint128(bound(floor, 1, oip >> 72)); // a ratio of at least 2^72 puts the edge below 2^129
        uint256 divisor = uint256(weight) * oip;
        uint256 edge = Math.mulDiv(MAX_CLASS_VOTES + 1, floor, divisor);
        if (mulmod(MAX_CLASS_VOTES + 1, floor, divisor) == 0) --edge; // exactly (2^200 + 1) * floor is over
        if (edge >= type(uint128).max) return; // the edge is past every authorised amount

        vm.prank(address(governor));
        uint8 id = captable.createClass(_params(weight, uint128(edge), oip, floor));
        assertEq(captable.getClass(id).authorised, edge, "the edge is accepted");

        vm.prank(address(governor));
        vm.expectRevert(abi.encodeWithSelector(ICaptable.VotesBoundExceeded.selector, id + 1));
        captable.createClass(_params(weight, uint128(edge + 1), oip, floor));
    }

    function testFuzz_CreateClass_ReserveRoundsUp(uint128 authorised, uint128 oip, uint128 floor) external {
        authorised = uint128(bound(authorised, 1, 1_000_000));
        oip = uint128(bound(oip, 1, 1e9));
        floor = uint128(bound(floor, 1, oip));
        uint256 reserve = Math.mulDiv(authorised, oip, floor, Math.Rounding.Ceil);
        ICaptable.ClassParams memory p = _params(1, authorised, oip, floor);
        p.convertsInto = COMMON;

        vm.prank(address(governor));
        if (SERIES_A_RESERVE + reserve > COMMON_AUTHORISED) {
            vm.expectPartialRevert(ICaptable.AuthorisedExceeded.selector);
            captable.createClass(p);
        } else {
            captable.createClass(p);
            assertEq(captable.convertibleReserved(COMMON), SERIES_A_RESERVE + reserve, "reserve rounded up");
        }
    }
}
