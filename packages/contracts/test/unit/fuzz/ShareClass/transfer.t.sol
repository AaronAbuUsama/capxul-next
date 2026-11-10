// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICaptable } from "../../../../src/interfaces/ICaptable.sol";
import { ShareClass_Fuzz_Shared } from "./ShareClass_Fuzz_Shared.sol";
import { MockCaptableForShareClass } from "../../../utils/ShareClass/MockCaptableForShareClass.sol";

/// @dev Fuzz of the transfer tree: any receiver (the Safe included), any part of the balance, each refusal.
contract Transfer_ShareClass_Unit_Fuzz_Test is ShareClass_Fuzz_Shared {
    function testFuzz_RevertWhen_CheckTransferRefuses(address to, uint256 amount, uint128 locked, bool lock) external {
        to = _account(to);
        vm.assume(to != users.alice);
        _mint(users.alice, 1000);
        amount = bound(amount, 0, 1000);
        if (lock) {
            captable.setAnswer(MockCaptableForShareClass.Answer.Locked, locked);
            vm.expectRevert(abi.encodeWithSelector(ICaptable.SharesLocked.selector, users.alice, locked));
        } else {
            captable.setAnswer(MockCaptableForShareClass.Answer.NotAllowed, 0);
            vm.expectRevert(abi.encodeWithSelector(ICaptable.TransferNotAllowed.selector, CLASS_ID, users.alice, to));
        }
        vm.prank(users.alice);
        token.transfer(to, amount);
    }

    function testFuzz_Transfer(address to, uint256 minted, uint256 sent) external {
        to = _account(to);
        vm.assume(to != users.alice);
        minted = _amount(minted);
        sent = bound(sent, 0, minted);
        _mint(users.alice, minted);
        vm.expectCall(address(captable), abi.encodeCall(ICaptable.checkTransfer, (CLASS_ID, users.alice, to, sent)), 1);
        vm.prank(users.alice);
        token.transfer(to, sent);
        assertEq(token.balanceOf(users.alice), minted - sent, "alice balance");
        assertEq(token.balanceOf(to), sent, "to balance");
        assertEq(token.getVotes(users.alice), minted - sent, "alice votes");
        assertEq(token.getVotes(to), to == address(safe) ? 0 : sent, "to votes");
        assertEq(token.safeBalanceAt(vm.getBlockTimestamp()), token.balanceOf(address(safe)), "safe checkpoint");
    }
}
