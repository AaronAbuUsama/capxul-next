// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IOptions } from "../../../../src/interfaces/IOptions.sol";
import { Options_Shared_Test } from "../../../utils/Options/Options_Shared_Test.sol";

/// @dev `exercise` over the time, two exercise sizes and the strike price: O1 (`exercised <= vested`), the exact
/// strike `shares * strikePrice` moved grantee to Safe, the pool shrinking (F9) and Options holding nothing.
contract Exercise_Options_Unit_Fuzz_Test is Options_Shared_Test {
    function testFuzz_Exercise(uint64 t, uint128 a, uint128 b) external {
        uint256 id = _acceptedGrant();
        t = uint64(bound(t, gStart, gExpires));
        vm.warp(t);
        uint128 vested = _model(SHARES, gStart, gCliff, gEnd, 0, t);
        a = uint128(bound(a, 1, SHARES));
        b = uint128(bound(b, 1, SHARES));
        _try(id, a, vested, 0);
        uint128 done = a <= vested ? a : 0;
        _try(id, b, vested, done);
        assertLe(options.getGrant(id).exercised, options.vestedOf(id, t), "O1");
        assertEq(options.allocated() + options.getGrant(id).exercised, SHARES, "allocated + exercised");
        assertEq(options.pool() + options.getGrant(id).exercised, POOL, "pool shrinks by exercised");
        _assertHoldsNothing();
    }

    function testFuzz_Exercise_StrikeIsExact(uint128 strikePrice, uint128 shares) external {
        strikePrice = uint128(bound(strikePrice, 1, 1e12)); // up to $1,000,000 a share
        shares = uint128(bound(shares, 1, SHARES));
        uint256 owed = uint256(shares) * strikePrice;
        usdc.mint(users.alice, owed);
        vm.prank(address(safe));
        uint256 id = options.grant(
            users.alice, SHARES, address(usdc), strikePrice, gStart, gCliff, gEnd, _now() + 1, gExpires, 0, DOC
        );
        _accept(id);
        vm.warp(gEnd);
        uint256 aliceBefore = usdc.balanceOf(users.alice);
        uint256 safeBefore = usdc.balanceOf(address(safe));
        _exercise(id, shares);
        assertEq(aliceBefore - usdc.balanceOf(users.alice), owed, "grantee paid the strike");
        assertEq(usdc.balanceOf(address(safe)) - safeBefore, owed, "Safe received the strike");
        assertEq(common.balanceOf(users.alice), shares, "shares issued");
        _assertHoldsNothing();
    }

    /// @dev Judgement call (plans/Options.md): a zero strike issues the shares with no payment.
    function testFuzz_Exercise_ZeroStrikePaysNothing(uint128 shares) external {
        shares = uint128(bound(shares, 1, SHARES));
        vm.prank(address(safe));
        uint256 id =
            options.grant(users.alice, SHARES, address(usdc), 0, gStart, gCliff, gEnd, _now() + 1, gExpires, 0, DOC);
        _accept(id);
        vm.warp(gEnd);
        uint256 safeBefore = usdc.balanceOf(address(safe));
        vm.recordLogs();
        _exercise(id, shares);
        (, uint128 logged, uint256 paid, bytes32 paymentId) = _exercisedLog();
        assertEq(logged, shares, "shares");
        assertEq(paid, 0, "paid nothing");
        assertEq(paymentId, bytes32(0), "no payment");
        assertEq(usdc.balanceOf(address(safe)), safeBefore, "Safe unchanged");
        assertEq(common.balanceOf(users.alice), shares, "shares issued");
    }

    function _try(uint256 id, uint128 n, uint128 vested, uint128 exercised) private {
        vm.prank(users.alice);
        if (vested == 0 || exercised + n > vested) {
            vm.expectRevert(abi.encodeWithSelector(IOptions.NotVested.selector, vested, exercised, n));
            options.exercise(id, n);
        } else {
            options.exercise(id, n);
            assertEq(options.getGrant(id).exercised, exercised + n, "exercised");
            assertEq(common.balanceOf(users.alice), exercised + n, "issued");
        }
    }
}
