// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IShareClass } from "../../../../src/interfaces/IShareClass.sol";
import { ShareClass_Fuzz_Shared } from "./ShareClass_Fuzz_Shared.sol";

/// @dev Fuzz of the burn tree: any holder (the Safe included), any part of the balance.
contract Burn_ShareClass_Unit_Fuzz_Test is ShareClass_Fuzz_Shared {
    function testFuzz_RevertWhen_CallerIsNotTheCaptable(address caller, uint256 amount) external {
        vm.assume(caller != address(captable));
        _mint(users.alice, 100);
        vm.expectRevert(IShareClass.OnlyCaptable.selector);
        vm.prank(caller);
        token.burn(users.alice, bound(amount, 0, 100));
    }

    function testFuzz_Burn(address holder, uint256 minted, uint256 burnt) external {
        holder = _account(holder);
        minted = _amount(minted);
        burnt = bound(burnt, 0, minted);
        _mint(holder, minted);
        _expectNoTransferCheck();
        _burn(holder, burnt);
        assertEq(token.balanceOf(holder), minted - burnt, "balance");
        assertEq(token.totalSupply(), minted - burnt, "supply");
        if (holder == address(safe)) {
            assertEq(token.getVotes(holder), 0, "safe votes");
            assertEq(token.safeBalanceAt(vm.getBlockTimestamp()), minted - burnt, "safe checkpoint");
        } else {
            assertEq(token.getVotes(holder), minted - burnt, "votes");
        }
    }
}
