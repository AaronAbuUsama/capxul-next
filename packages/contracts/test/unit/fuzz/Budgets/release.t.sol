// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { stdError } from "forge-std/StdError.sol";

import { Budgets_Shared_Test } from "../../../utils/Budgets/Budgets_Shared_Test.sol";

/// @notice release.tree over amounts: frees exactly what it is asked up to ownCommitted, and never
/// underflows past it.
contract Release_Budgets_Unit_Fuzz_Test is Budgets_Shared_Test {
    function testFuzz_ReleasesIffAtMostOwnCommitted(uint128 reserved, uint128 amount) external {
        _tree();
        reserved = uint128(bound(reserved, 0, OFFSITE_AMOUNT));
        _commit(offsite, reserved);
        vm.prank(agreements);
        if (amount > reserved) {
            vm.expectRevert(stdError.arithmeticError);
            budgets.release(offsite, amount);
        } else {
            budgets.release(offsite, amount);
            assertEq(_budget(offsite).ownCommitted, reserved - amount, "ownCommitted");
            assertEq(_budget(top).committed, reserved - amount, "committed at the top");
        }
    }
}
