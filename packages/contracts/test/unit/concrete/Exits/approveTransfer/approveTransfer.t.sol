// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IExits } from "../../../../../src/interfaces/IExits.sol";
import { Exits_Test } from "../../../../utils/Exits/Exits_Test.sol";

/// @dev spec/exits.md `approveTransfer` (the Board approves an offered secondary sale); invariant H4.
contract ApproveTransfer_Exits_Unit_Concrete_Test is Exits_Test {
    function _offer() internal returns (uint256 id) {
        vm.prank(users.ben);
        id = exits.offerTransfer(COMMON, users.investor, 400, 1.5e6, address(usdc), DOC);
    }

    function test_WhenTheCallerIsNotTheSafe() external {
        // it should revert with OnlyBoard
        uint256 id = _offer();
        address[3] memory callers = [users.eve, users.ben, governor];
        for (uint256 i; i < callers.length; ++i) {
            vm.expectRevert(IExits.OnlyBoard.selector);
            vm.prank(callers[i]);
            exits.approveTransfer(id);
        }
        assertFalse(exits.transfer(id).approved, "not approved");
    }

    function test_WhenTheTransferWasNeverOffered() external {
        // it should revert with UnknownTransfer
        vm.expectRevert(IExits.UnknownTransfer.selector);
        vm.prank(address(safe));
        exits.approveTransfer(0);
        uint256 id = _offer();
        vm.expectRevert(IExits.UnknownTransfer.selector);
        vm.prank(address(safe));
        exits.approveTransfer(id + 1);
    }

    function test_WhenTheTransferWasAlreadyBought() external {
        // it should revert with AlreadyBought
        uint256 id = _offer();
        vm.prank(users.ben);
        captable.consentToTransfer(COMMON, users.investor, 400, DOC);
        vm.prank(address(safe));
        exits.approveTransfer(id);
        vm.startPrank(users.investor);
        usdc.approve(address(exits), 600e6);
        exits.buy(id);
        vm.stopPrank();

        vm.expectRevert(IExits.AlreadyBought.selector);
        vm.prank(address(safe));
        exits.approveTransfer(id);
    }

    function test_WhenTheBoardApprovesAnOfferedSale() external {
        // it should mark the transfer approved
        // it should emit TransferApproved
        uint256 id = _offer();
        vm.expectEmit(address(exits));
        emit IExits.TransferApproved(id);
        vm.prank(address(safe));
        exits.approveTransfer(id);

        IExits.Transfer memory t = exits.transfer(id);
        assertTrue(t.approved, "approved");
        assertFalse(t.bought, "not bought");
        assertEq(t.seller, users.ben, "seller unchanged");
    }
}
