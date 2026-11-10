// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IOptions } from "../../../../../src/interfaces/IOptions.sol";
import { Options_Shared_Test } from "../../../../utils/Options/Options_Shared_Test.sol";

/// @dev spec/options.md `grant`; invariants H4 and O2. The schedule rules are Vesting's (spec/vesting.md, ported
/// from Firm VestingController.sol: `start <= cliff <= end`, a month step or `cliff == end`) plus `expiresAt > end`.
contract Grant_Options_Unit_Concrete_Test is Options_Shared_Test {
    function test_WhenTheCallerIsNotTheSafe() external {
        // it should revert with OnlyBoard
        vm.expectRevert(IOptions.OnlyBoard.selector);
        vm.prank(users.eve);
        options.grant(users.eve, SHARES, address(usdc), STRIKE, gStart, gCliff, gEnd, gStart + 1, gExpires, 0, DOC);
        vm.expectRevert(IOptions.OnlyBoard.selector);
        vm.prank(users.amira);
        options.grant(users.alice, SHARES, address(usdc), STRIKE, gStart, gCliff, gEnd, gStart + 1, gExpires, 0, DOC);
        assertEq(options.allocated(), 0, "nothing allocated");
    }

    function test_WhenTheSharesAreMoreThanThePoolLeft() external {
        // it should revert with PoolExceeded
        vm.expectRevert(abi.encodeWithSelector(IOptions.PoolExceeded.selector, POOL, POOL + 1));
        _grant(users.alice, POOL + 1, gStart, gCliff, gEnd, gExpires);

        _defaultGrant();
        uint128 left = POOL - SHARES;
        vm.expectRevert(abi.encodeWithSelector(IOptions.PoolExceeded.selector, left, left + 1));
        _grant(users.bob, left + 1, gStart, gCliff, gEnd, gExpires);
        assertEq(options.allocated(), SHARES, "allocated kept");
    }

    function test_WhenTheScheduleIsInvalidOrTheExpiryIsNotAfterTheVestingEnd() external {
        // it should revert with InvalidSchedule
        vm.expectRevert(IOptions.InvalidSchedule.selector);
        _grant(users.alice, SHARES, gCliff + 1, gCliff, gEnd, gExpires); // start after cliff
        vm.expectRevert(IOptions.InvalidSchedule.selector);
        _grant(users.alice, SHARES, gStart, gEnd + 1, gEnd, gExpires); // cliff after end
        vm.expectRevert(IOptions.InvalidSchedule.selector);
        _grant(users.alice, SHARES, gStart, gStart, gStart + 10 days, gExpires); // no month step, cliff before end
        vm.expectRevert(IOptions.InvalidSchedule.selector);
        _grant(users.alice, SHARES, gStart, gCliff, gEnd, gEnd); // expiry at the end
        vm.expectRevert(IOptions.InvalidSchedule.selector);
        _grant(users.alice, SHARES, gStart, gCliff, gEnd, gEnd - 1); // expiry before the end
        assertEq(options.allocated(), 0, "nothing allocated");
    }

    function test_WhenTheGrantFits() external {
        // it should record an offered grant
        // it should add the shares to allocated
        // it should emit OptionsGranted
        IOptions.OptionGrant memory expected =
            _offered(users.alice, SHARES, gStart, gCliff, gEnd, _now() + OFFER_WINDOW, gExpires);
        vm.expectEmit(address(options));
        emit IOptions.OptionsGranted(1, users.alice, expected);
        uint256 id = _defaultGrant();
        assertEq(id, 1, "ids start at 1");
        _assertGrant(options.getGrant(id), expected);
        assertEq(options.allocated(), SHARES, "allocated");
        assertEq(options.pool(), POOL, "pool unchanged");

        // All at once (cliff == end, no month step) is a valid schedule, and the rest of the pool fits.
        uint256 second = _grant(users.bob, POOL - SHARES, gStart, gStart + 10 days, gStart + 10 days, gExpires);
        assertEq(second, 2, "next id");
        assertEq(options.allocated(), POOL, "allocated is the whole pool");
    }
}
