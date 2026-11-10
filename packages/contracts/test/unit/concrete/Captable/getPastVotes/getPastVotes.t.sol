// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Captable_Test } from "../../../../utils/Captable/Captable_Test.sol";

/// @dev E3 and D5: votes(a, t) = sum over classes of mulDiv(weight * classVotes(a, t), oip, cp(t)), ratio 1 for
/// Common, and 0 for the Safe. Ports Firm `Captable.t.sol:503-537` (weights, votes follow transfers).
contract GetPastVotes_Captable_Unit_Concrete_Test is Captable_Test {
    function test_WhenTheTimepointIsNotInThePast() external {
        _issue(COMMON, users.amira, 1000);

        // it should revert with the ERC5805 future lookup error
        vm.expectRevert(abi.encodeWithSelector(FUTURE_LOOKUP, vm.getBlockTimestamp(), uint48(vm.getBlockTimestamp())));
        captable.getPastVotes(users.amira, vm.getBlockTimestamp());

        vm.expectRevert(
            abi.encodeWithSelector(FUTURE_LOOKUP, vm.getBlockTimestamp() + 1, uint48(vm.getBlockTimestamp()))
        );
        captable.getPastVotes(users.amira, vm.getBlockTimestamp() + 1);
    }

    modifier whenTheTimepointIsInThePast() {
        _;
    }

    function test_WhenTheTimepointIsInThePast() external whenTheTimepointIsInThePast {
        // Amira: 1,000 Common, 100 Series A (cp = oip), 1 share of a weight-3 class at cp 0.60 (oip 1.00).
        uint8 seriesB = _createClass(_params(3, 1000, 1e6, 5e5));
        _lowerPrice(seriesB, 6e5);
        _issue(COMMON, users.amira, 1000);
        _issue(SERIES_A, users.amira, 100);
        _issue(seriesB, users.amira, 1);

        // Two classes at cp 0.80 (oip 1.00): Bob holds 3 of each, 3.75 votes each before rounding.
        uint8 c1 = _createClass(_params(1, 1000, 1e6, 5e5));
        uint8 c2 = _createClass(_params(1, 1000, 1e6, 5e5));
        _lowerPrice(c1, 8e5);
        _lowerPrice(c2, 8e5);
        _issue(c1, users.bob, 3);
        _issue(c2, users.bob, 3);

        // Large terms: a product past 2^256 before the division.
        uint8 big = _createClass(_params(2 ** 15, 2 ** 127, 2 ** 120, 2 ** 62));
        _issue(big, users.alice, 2 ** 127);
        _warp(1);
        uint256 t = vm.getBlockTimestamp() - 1;

        // it should sum over classes weight times the class votes at that time times the conversion ratio at that time
        // 1000 + 100 * 2.00 / 2.00 + floor(3 * 1 * 1.00 / 0.60) = 1000 + 100 + 5
        assertEq(captable.getPastVotes(users.amira, t), 1105, "Amira's weighted, as-converted votes");

        // it should multiply with mulDiv and round down once per class
        assertEq(captable.getPastVotes(users.bob, t), 6, "floor(3.75) + floor(3.75), not floor(7.5)");
        assertEq(
            captable.getPastVotes(users.alice, t), uint256(2 ** 15) * 2 ** 127, "2^142 * 2^120 / 2^120, no overflow"
        );
    }

    function test_GivenAClassHasWeight0() external whenTheTimepointIsInThePast {
        uint8 nonVoting = _createClass(_params(0, 1000, 0, 0));
        _issue(COMMON, users.amira, 1000);
        _issue(nonVoting, users.amira, 1000);
        _warp(1);

        // it should add nothing for it
        assertEq(captable.getPastVotes(users.amira, vm.getBlockTimestamp() - 1), 1000, "only Common counts");
    }

    function test_GivenCommon() external whenTheTimepointIsInThePast {
        _issue(COMMON, users.amira, 5_000_000);
        _issue(COMMON, users.ben, 3_000_000);
        _warp(1);

        // it should use a ratio of 1
        assertEq(captable.getPastVotes(users.amira, vm.getBlockTimestamp() - 1), 5_000_000, "Amira");
        assertEq(captable.getPastVotes(users.ben, vm.getBlockTimestamp() - 1), 3_000_000, "Ben");
    }

    function test_GivenADownRoundLoweredAConversionPriceAfterTheTimepoint() external whenTheTimepointIsInThePast {
        _issue(SERIES_A, users.investor, 100);
        _warp(1 days);
        uint256 before = vm.getBlockTimestamp() - 1;
        _lowerPrice(SERIES_A, SERIES_A_FLOOR);
        _warp(1);

        // it should use the price at the timepoint
        assertEq(captable.getPastVotes(users.investor, before), 100, "the price then: ratio 1");
        assertEq(captable.getPastVotes(users.investor, vm.getBlockTimestamp() - 1), 200, "the price now: ratio 2");
    }

    function test_GivenTheAccountIsTheSafeHoldingShares() external whenTheTimepointIsInThePast {
        _issue(COMMON, address(safe), 1_000_000);
        _issue(SERIES_A, address(safe), 1000);
        _warp(1);

        // it should return 0
        assertEq(captable.getPastVotes(address(safe), vm.getBlockTimestamp() - 1), 0, "the Safe never votes");
        assertEq(captable.getVotes(address(safe)), 0, "nor now");
    }

    function test_Given32ClassesAtTheVoteBound() external whenTheTimepointIsInThePast {
        _issue(COMMON, users.amira, 1000);
        for (uint256 i = 2; i < MAX_CLASSES; ++i) {
            uint8 id = _createClass(_params(2 ** 15, 2 ** 127, 2 ** 58, 1));
            _issue(id, users.amira, 2 ** 127);
            _lowerPrice(id, 1); // the floor: the highest ratio
        }
        assertEq(captable.numberOfClasses(), MAX_CLASSES, "32 classes");
        _warp(1);

        // it should not revert
        assertEq(
            captable.getPastVotes(users.amira, vm.getBlockTimestamp() - 1), 30 * MAX_CLASS_VOTES + 1000, "30 x 2^200"
        );
        assertEq(captable.getVotes(users.amira), 30 * MAX_CLASS_VOTES + 1000, "now too");
    }
}
