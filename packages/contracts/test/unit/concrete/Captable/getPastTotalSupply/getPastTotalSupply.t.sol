// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Captable_Test } from "../../../../utils/Captable/Captable_Test.sol";

/// @dev E3 and D5 (R1 N-3, E8): supply(t) = sum over voting classes of
/// mulDiv(weight * (supply(t) - safeBalanceAt(t)), oip, cp(t)): the Safe's shares never count toward quorum.
contract GetPastTotalSupply_Captable_Unit_Concrete_Test is Captable_Test {
    function test_WhenTheTimepointIsNotInThePast() external {
        _issue(COMMON, users.amira, 1000);

        // it should revert with the ERC5805 future lookup error
        vm.expectRevert(abi.encodeWithSelector(FUTURE_LOOKUP, vm.getBlockTimestamp(), uint48(vm.getBlockTimestamp())));
        captable.getPastTotalSupply(vm.getBlockTimestamp());

        vm.expectRevert(
            abi.encodeWithSelector(FUTURE_LOOKUP, vm.getBlockTimestamp() + 1, uint48(vm.getBlockTimestamp()))
        );
        captable.getPastTotalSupply(vm.getBlockTimestamp() + 1);
    }

    modifier whenTheTimepointIsInThePast() {
        _;
    }

    function test_WhenTheTimepointIsInThePast() external whenTheTimepointIsInThePast {
        _issue(COMMON, users.amira, 1000);
        _issue(COMMON, users.ben, 600);
        _issue(SERIES_A, users.investor, 100);
        _warp(1 days);
        uint256 before = vm.getBlockTimestamp() - 1;
        _lowerPrice(SERIES_A, SERIES_A_FLOOR);
        _warp(1);

        // it should sum over voting classes weight times supply less the Safe's shares at that time times the ratio at that time
        assertEq(captable.getPastTotalSupply(before), 1600 + 100, "ratio 1 then");
        assertEq(captable.getPastTotalSupply(vm.getBlockTimestamp() - 1), 1600 + 200, "ratio 2 now");
    }

    function test_GivenTheSafeHoldsSharesOfAVotingClass() external whenTheTimepointIsInThePast {
        _issue(COMMON, users.amira, 1000);
        _issue(COMMON, address(safe), 4000);
        _issue(SERIES_A, address(safe), 50);
        _warp(1);

        // it should leave them out
        assertEq(_token(COMMON).totalSupply(), 5000, "the class supply includes the Safe");
        assertEq(captable.getPastTotalSupply(vm.getBlockTimestamp() - 1), 1000, "the company supply does not");
    }

    function test_GivenAClassHasWeight0() external whenTheTimepointIsInThePast {
        uint8 nonVoting = _createClass(_params(0, 1_000_000, 0, 0));
        _issue(COMMON, users.amira, 1000);
        _issue(nonVoting, users.bob, 1_000_000);
        _warp(1);

        // it should add nothing for it
        assertEq(captable.getPastTotalSupply(vm.getBlockTimestamp() - 1), 1000, "weight 0 adds nothing");
    }

    function test_ItShouldRoundDownOncePerClass() external whenTheTimepointIsInThePast {
        // Two classes at cp 0.80 (oip 1.00) with 3 shares each: 3.75 + 3.75.
        uint8 c1 = _createClass(_params(1, 1000, 1e6, 5e5));
        uint8 c2 = _createClass(_params(1, 1000, 1e6, 5e5));
        _lowerPrice(c1, 8e5);
        _lowerPrice(c2, 8e5);
        _issue(c1, users.bob, 3);
        _issue(c2, users.alice, 3);
        // A weight-3 class at cp 0.60 with 1 share: floor(3 / 0.6) = 5, not 3 * floor(1 / 0.6) = 3.
        uint8 c3 = _createClass(_params(3, 1000, 1e6, 5e5));
        _lowerPrice(c3, 6e5);
        _issue(c3, users.ben, 1);
        _warp(1);

        // it should round down once per class
        assertEq(captable.getPastTotalSupply(vm.getBlockTimestamp() - 1), 3 + 3 + 5, "floor per class, once");
    }

    function test_Given32ClassesAtTheVoteBound() external whenTheTimepointIsInThePast {
        _issue(COMMON, users.amira, 1000);
        for (uint256 i = 2; i < MAX_CLASSES; ++i) {
            uint8 id = _createClass(_params(2 ** 15, 2 ** 127, 2 ** 58, 1));
            _issue(id, users.bob, 2 ** 127);
            _lowerPrice(id, 1);
        }
        _warp(1);

        // it should not revert
        assertEq(captable.getPastTotalSupply(vm.getBlockTimestamp() - 1), 30 * MAX_CLASS_VOTES + 1000, "30 x 2^200");
    }
}
