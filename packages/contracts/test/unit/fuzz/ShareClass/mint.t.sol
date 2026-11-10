// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IShareClass } from "../../../../src/interfaces/IShareClass.sol";
import { ShareClass_Fuzz_Shared } from "./ShareClass_Fuzz_Shared.sol";

/// @dev Fuzz of the mint tree: any caller but the Captable, any receiver, any uint128 amount.
contract Mint_ShareClass_Unit_Fuzz_Test is ShareClass_Fuzz_Shared {
    function testFuzz_RevertWhen_CallerIsNotTheCaptable(address caller, address to, uint256 amount) external {
        vm.assume(caller != address(captable));
        to = _account(to);
        vm.expectRevert(IShareClass.OnlyCaptable.selector);
        vm.prank(caller);
        token.mint(to, _amount(amount));
    }

    function testFuzz_Mint(address to, uint256 amount, uint32 later) external {
        to = _account(to);
        amount = _amount(amount);
        uint256 t0 = vm.getBlockTimestamp();
        _expectNoTransferCheck();
        _mint(to, amount);
        assertEq(token.balanceOf(to), amount, "balance");
        assertEq(token.totalSupply(), amount, "supply");
        vm.warp(t0 + bound(later, 1, 3650 days));
        assertEq(token.getPastTotalSupply(t0), amount, "supply checkpoint");
        if (to == address(safe)) {
            assertEq(token.getVotes(to), 0, "safe votes");
            assertEq(token.delegates(to), address(0), "safe delegate");
            assertEq(token.safeBalanceAt(t0), amount, "safe checkpoint");
        } else {
            assertEq(token.getVotes(to), amount, "self-delegated votes");
            assertEq(token.safeBalanceAt(t0), 0, "safe untouched");
        }
    }
}
