// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IOptions } from "../../../../src/interfaces/IOptions.sol";
import { Options_Shared_Test } from "../../../utils/Options/Options_Shared_Test.sol";

/// @dev `setPool` over every amount and every allocated figure: refused exactly below `allocated` (O2).
contract SetPool_Options_Unit_Fuzz_Test is Options_Shared_Test {
    function testFuzz_SetPool(uint128 granted, uint128 amount) external {
        granted = uint128(bound(granted, 1, POOL));
        _grant(users.alice, granted, gStart, gCliff, gEnd, gExpires);
        vm.prank(address(safe));
        if (amount < granted) {
            vm.expectRevert(abi.encodeWithSelector(IOptions.PoolBelowAllocated.selector, granted));
            options.setPool(amount);
            assertEq(options.pool(), POOL, "pool kept");
        } else {
            vm.expectEmit(address(options));
            emit IOptions.PoolSet(amount);
            options.setPool(amount);
            assertEq(options.pool(), amount, "pool set");
            assertLe(options.allocated(), options.pool(), "O2");
        }
    }

    function testFuzz_SetPool_RevertWhen_NotTheSafe(address caller, uint128 amount) external {
        vm.assume(caller != address(safe));
        vm.expectRevert(IOptions.OnlyBoard.selector);
        vm.prank(caller);
        options.setPool(amount);
    }
}
