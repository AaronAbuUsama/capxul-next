// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IOptions } from "../../../../../src/interfaces/IOptions.sol";
import { Options_Shared_Test } from "../../../../utils/Options/Options_Shared_Test.sol";

/// @dev spec/options.md `setPool`; invariants H4 (Board only) and O2 (`allocated <= pool`). New: Firm has no options.
contract SetPool_Options_Unit_Concrete_Test is Options_Shared_Test {
    function test_WhenTheCallerIsNotTheSafe() external {
        // it should revert with OnlyBoard
        vm.expectRevert(IOptions.OnlyBoard.selector);
        vm.prank(users.eve);
        options.setPool(2 * POOL);
        // A Director acting alone is not the Board.
        vm.expectRevert(IOptions.OnlyBoard.selector);
        vm.prank(users.amira);
        options.setPool(2 * POOL);
        assertEq(options.pool(), POOL, "pool kept");
    }

    function test_WhenTheAmountIsBelowWhatIsAllocated() external {
        // it should revert with PoolBelowAllocated
        _defaultGrant();
        vm.expectRevert(abi.encodeWithSelector(IOptions.PoolBelowAllocated.selector, SHARES));
        vm.prank(address(safe));
        options.setPool(SHARES - 1);
        assertEq(options.pool(), POOL, "pool kept");
    }

    function test_WhenTheAmountCoversWhatIsAllocated() external {
        // it should set the pool
        // it should emit PoolSet
        _defaultGrant();
        vm.expectEmit(address(options));
        emit IOptions.PoolSet(SHARES);
        _setPool(SHARES); // exactly what is allocated
        assertEq(options.pool(), SHARES, "pool lowered to allocated");
        assertEq(options.allocated(), SHARES, "allocated kept");

        vm.expectEmit(address(options));
        emit IOptions.PoolSet(3 * POOL);
        _setPool(3 * POOL);
        assertEq(options.pool(), 3 * POOL, "pool raised");
    }
}
