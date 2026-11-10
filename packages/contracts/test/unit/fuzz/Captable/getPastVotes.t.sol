// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { Captable_Test } from "../../../utils/Captable/Captable_Test.sol";

/// @dev E3 per class over a range of weights, holdings and prices; plus the C-15 gas benchmark at 32 classes
/// with deep checkpoint histories (Firm `Captable.t.sol:629-720` measured 128 classes x 64 checkpoints).
contract GetPastVotes_Captable_Unit_Fuzz_Test is Captable_Test {
    /// @dev The full range J13 leaves to this fuzz from Halmos `check_E3_classVotes`: every `uint16` weight,
    /// every `uint128` price with floor <= cp <= oip, and every share count the vote bound (E9) admits. The
    /// result is checked against the exact 512-bit bracket votes * cp <= weight * shares * oip < (votes + 1) * cp
    /// as well as against mulDiv.
    function testFuzz_GetPastVotes_Formula(
        uint16 weight,
        uint128 shares,
        uint128 oip,
        uint128 floor,
        uint128 cp
    )
        external
    {
        oip = uint128(bound(oip, 1, type(uint128).max));
        floor = uint128(bound(floor, 1, oip));
        cp = uint128(bound(cp, floor, oip));
        // The most shares the vote bound admits: weight * shares * oip <= 2^200 * floor.
        uint256 maxShares = weight == 0 ? type(uint128).max : Math.mulDiv(MAX_CLASS_VOTES, floor, uint256(weight) * oip);
        shares = uint128(bound(shares, 1, Math.min(maxShares, type(uint128).max)));
        uint8 id = _createClass(_params(weight, shares, oip, floor));
        _issue(id, users.bob, shares);
        if (cp < oip) _lowerPrice(id, cp);
        _warp(1);

        uint256 votes = captable.getPastVotes(users.bob, vm.getBlockTimestamp() - 1);
        assertEq(votes, _classVotes(weight, shares, oip, cp), "E3");
        _assertBracket(votes, uint256(weight) * shares, oip, cp);
        assertEq(
            captable.getPastTotalSupply(vm.getBlockTimestamp() - 1), _classVotes(weight, shares, oip, cp), "E3 supply"
        );
    }

    /// @dev votes * cp <= base * oip < (votes + 1) * cp, in 512 bits.
    function _assertBracket(uint256 votes, uint256 base, uint256 oip, uint256 cp) internal pure {
        (uint256 nHi, uint256 nLo) = Math.mul512(base, oip);
        (uint256 lHi, uint256 lLo) = Math.mul512(votes, cp);
        (uint256 rHi, uint256 rLo) = Math.mul512(votes + 1, cp);
        assertTrue(lHi < nHi || (lHi == nHi && lLo <= nLo), "E3: rounded up");
        assertTrue(nHi < rHi || (nHi == rHi && nLo < rLo), "E3: rounded down more than once");
    }

    function test_Gas_GetPastVotes_32ClassesDeepHistory() external {
        _fillClassesTo(MAX_CLASSES);
        // 64 checkpoints per class for Amira.
        for (uint256 k; k < 64; ++k) {
            for (uint8 c = 2; c < MAX_CLASSES; ++c) {
                _issue(c, users.amira, 1);
            }
            _warp(1);
        }
        uint256 t = vm.getBlockTimestamp() - 33;

        uint256 gasBefore = gasleft();
        uint256 votes = captable.getPastVotes(users.amira, t);
        uint256 used = gasBefore - gasleft();
        emit log_named_uint("getPastVotes gas, 32 classes x 64 checkpoints", used);
        assertEq(votes, 30 * 32, "30 classes x 32 shares at t");

        gasBefore = gasleft();
        uint256 supply = captable.getPastTotalSupply(t);
        emit log_named_uint("getPastTotalSupply gas, 32 classes x 64 checkpoints", gasBefore - gasleft());
        assertEq(supply, 30 * 32, "the same supply");
    }
}
