// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IShareClass } from "../../../../src/interfaces/IShareClass.sol";
import { ShareClass_Fuzz_Shared } from "./ShareClass_Fuzz_Shared.sol";
import { MockCaptableForShareClass } from "../../../utils/ShareClass/MockCaptableForShareClass.sol";

/// @dev Fuzz of the forcedMove tree: any pair of accounts (the Safe on either side), any part of the balance,
/// with the transfer rule refusing everything (a Captable move skips it).
contract ForcedMove_ShareClass_Unit_Fuzz_Test is ShareClass_Fuzz_Shared {
    function testFuzz_RevertWhen_CallerIsNotTheCaptable(address caller, address to) external {
        vm.assume(caller != address(captable));
        to = _account(to);
        _mint(users.alice, 100);
        vm.expectRevert(IShareClass.OnlyCaptable.selector);
        vm.prank(caller);
        token.forcedMove(users.alice, to, 100);
    }

    function testFuzz_ForcedMove(address from, address to, uint256 minted, uint256 moved, uint32 later) external {
        from = _account(from);
        to = _account(to);
        vm.assume(from != to);
        minted = _amount(minted);
        moved = bound(moved, 0, minted);
        _mint(from, minted);
        uint256 t0 = vm.getBlockTimestamp();
        vm.warp(t0 + bound(later, 1, 3650 days));
        captable.setAnswer(MockCaptableForShareClass.Answer.NotAllowed, 0);
        _expectNoTransferCheck();
        _forcedMove(from, to, moved);
        assertEq(token.balanceOf(from), minted - moved, "from balance");
        assertEq(token.balanceOf(to), moved, "to balance");
        assertEq(token.getVotes(address(safe)), 0, "safe never votes");
        assertEq(token.safeBalanceAt(vm.getBlockTimestamp()), token.balanceOf(address(safe)), "safe checkpoint now");
        assertEq(token.safeBalanceAt(t0), from == address(safe) ? minted : 0, "safe checkpoint before");
        if (from != address(safe)) assertEq(token.getVotes(from), minted - moved, "from votes");
        if (to != address(safe)) {
            assertEq(token.getVotes(to), moved, "to votes");
            if (moved > 0) assertEq(token.delegates(to), to, "to self-delegated");
        }
    }
}
