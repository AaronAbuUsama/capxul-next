// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICaptable } from "../../../../../src/interfaces/ICaptable.sol";
import { Captable_Test } from "../../../../utils/Captable/Captable_Test.sol";

contract ConsentToTransfer_Captable_Unit_Concrete_Test is Captable_Test {
    function test_WhenTheClassDoesNotExist() external {
        // it should revert with UnknownClass
        vm.prank(users.amira);
        vm.expectRevert(abi.encodeWithSelector(ICaptable.UnknownClass.selector, uint8(2)));
        captable.consentToTransfer(2, users.bob, 100, REASON);
    }

    function test_WhenTheReasonIsZero() external {
        // it should revert with ZeroReason
        vm.prank(users.amira);
        vm.expectRevert(ICaptable.ZeroReason.selector);
        captable.consentToTransfer(COMMON, users.bob, 100, bytes32(0));
    }

    function test_WhenTheAmountIs0() external {
        // it should revert with ZeroAmount
        vm.prank(users.amira);
        vm.expectRevert(ICaptable.ZeroAmount.selector);
        captable.consentToTransfer(COMMON, users.bob, 0, REASON);
    }

    function test_WhenTheShareholderConsentsForTheirOwnShares() external {
        _issue(COMMON, users.amira, 1000);
        bytes32 id = _consentId(COMMON, users.amira, users.bob, 100, REASON);

        // it should emit TransferConsented
        vm.expectEmit(address(captable));
        emit ICaptable.TransferConsented(id, COMMON, users.amira, users.bob, 100, REASON);
        vm.prank(users.amira);
        captable.consentToTransfer(COMMON, users.bob, 100, REASON);

        // it should record the consent id of the class and the caller and the receiver and the amount and the reason
        assertTrue(captable.transferConsent(id), "consent recorded");
        assertFalse(captable.transferConsent(_consentId(COMMON, users.bob, users.amira, 100, REASON)), "only hers");

        // it should move no shares
        assertEq(_token(COMMON).balanceOf(users.amira), 1000, "nothing moved");
        assertEq(_token(COMMON).balanceOf(users.bob), 0, "nothing received");

        // it should let only the Safe or Exits use it in forcedTransfer
        vm.prank(users.eve);
        vm.expectRevert(ICaptable.OnlyBoard.selector);
        captable.forcedTransfer(COMMON, users.amira, users.bob, 100, REASON);
        vm.prank(users.bob);
        vm.expectRevert(ICaptable.OnlyBoard.selector);
        captable.forcedTransfer(COMMON, users.amira, users.bob, 100, REASON);
        assertTrue(captable.transferConsent(id), "still unused");

        vm.prank(exits);
        captable.forcedTransfer(COMMON, users.amira, users.bob, 100, REASON);
        assertFalse(captable.transferConsent(id), "used up by Exits");
        assertEq(_token(COMMON).balanceOf(users.bob), 100, "moved by Exits with consent");
    }
}
