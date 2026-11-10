// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IShareClass } from "../../../../src/interfaces/IShareClass.sol";
import { ShareClass_Fuzz_Shared } from "./ShareClass_Fuzz_Shared.sol";

/// @dev Fuzz of the delegate tree: any delegator to the Safe reverts; any other pair moves the votes.
contract Delegate_ShareClass_Unit_Fuzz_Test is ShareClass_Fuzz_Shared {
    function testFuzz_RevertWhen_DelegateeIsTheSafe(address delegator, uint256 amount) external {
        delegator = _holder(delegator);
        _mint(delegator, _amount(amount));
        vm.expectRevert(IShareClass.SafeCannotVote.selector);
        vm.prank(delegator);
        token.delegate(address(safe));
    }

    function testFuzz_RevertWhen_DelegatorIsTheSafe(address delegatee) external {
        _mint(address(safe), 100);
        vm.expectRevert(IShareClass.SafeCannotVote.selector);
        vm.prank(address(safe));
        token.delegate(delegatee);
    }

    function testFuzz_Delegate(address delegator, address delegatee, uint256 amount) external {
        delegator = _holder(delegator);
        vm.assume(delegatee != address(safe) && delegatee != address(0) && delegatee != delegator);
        amount = _amount(amount);
        _mint(delegator, amount);
        vm.prank(delegator);
        token.delegate(delegatee);
        assertEq(token.delegates(delegator), delegatee, "delegate");
        assertEq(token.getVotes(delegatee), amount, "delegatee votes");
        assertEq(token.getVotes(delegator), 0, "delegator votes");
    }
}
