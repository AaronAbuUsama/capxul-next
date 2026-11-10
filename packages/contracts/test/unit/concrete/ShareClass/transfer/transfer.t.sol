// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICaptable } from "../../../../../src/interfaces/ICaptable.sol";
import { ShareClass_Shared_Test } from "../../../../utils/ShareClass/ShareClass_Shared_Test.sol";
import { MockCaptableForShareClass } from "../../../../utils/ShareClass/MockCaptableForShareClass.sol";

/// @dev T-4: every move but the Captable's asks the Captable first.
contract Transfer_ShareClass_Unit_Concrete_Test is ShareClass_Shared_Test {
    function test_WhenTheCaptablesCheckTransferRefuses() external {
        _mint(users.alice, 100);
        // it should revert with the Captable's error
        captable.setAnswer(MockCaptableForShareClass.Answer.NotAllowed, 0);
        vm.expectRevert(abi.encodeWithSelector(ICaptable.TransferNotAllowed.selector, CLASS_ID, users.alice, users.bob));
        vm.prank(users.alice);
        token.transfer(users.bob, 10);

        captable.setAnswer(MockCaptableForShareClass.Answer.Locked, 60);
        vm.expectRevert(abi.encodeWithSelector(ICaptable.SharesLocked.selector, users.alice, uint128(60)));
        vm.prank(users.alice);
        token.transfer(users.bob, 10);
        assertEq(token.balanceOf(users.alice), 100, "balance kept");
    }

    modifier whenTheCaptablesCheckTransferAllowsIt() {
        _;
    }

    function test_WhenTheCaptablesCheckTransferAllowsIt() external whenTheCaptablesCheckTransferAllowsIt {
        _mint(users.alice, 100);
        vm.expectCall(
            address(captable),
            abi.encodeCall(ICaptable.checkTransfer, (CLASS_ID, users.alice, users.bob, uint256(40))),
            1
        );
        vm.prank(users.alice);
        assertTrue(token.transfer(users.bob, 40), "returns true");
        // it should move the balance
        assertEq(token.balanceOf(users.alice), 60, "alice balance");
        assertEq(token.balanceOf(users.bob), 40, "bob balance");
        // it should move the delegated votes
        assertEq(token.getVotes(users.alice), 60, "alice votes");
        assertEq(token.getVotes(users.bob), 40, "bob votes");
    }

    function test_GivenTheReceiverIsTheSafe() external whenTheCaptablesCheckTransferAllowsIt {
        _mint(users.alice, 100);
        vm.prank(users.alice);
        token.transfer(address(safe), 30);
        // it should checkpoint the Safe's balance and give it no votes
        assertEq(token.safeBalanceAt(vm.getBlockTimestamp()), 30, "safe balance");
        assertEq(token.delegates(address(safe)), address(0), "safe delegate");
        assertEq(token.getVotes(address(safe)), 0, "safe votes");
        assertEq(token.getVotes(users.alice), 70, "alice votes");
    }

    function test_GivenItIsATransferFrom() external whenTheCaptablesCheckTransferAllowsIt {
        _mint(users.alice, 100);
        vm.prank(users.alice);
        token.approve(users.bob, 50);
        // it should ask the Captable with the owner as the sender
        vm.expectCall(
            address(captable),
            abi.encodeCall(ICaptable.checkTransfer, (CLASS_ID, users.alice, users.jordan, uint256(20))),
            1
        );
        vm.prank(users.bob);
        assertTrue(token.transferFrom(users.alice, users.jordan, 20), "returns true");
        assertEq(token.balanceOf(users.jordan), 20, "jordan balance");
        assertEq(token.balanceOf(users.alice), 80, "alice balance");
    }
}
