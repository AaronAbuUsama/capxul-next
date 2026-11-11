// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IExits } from "../../../../../src/interfaces/IExits.sol";
import { IPayments } from "../../../../../src/interfaces/IPayments.sol";
import { Exits_Test } from "../../../../utils/Exits/Exits_Test.sol";

/// @dev spec/exits.md `offerTransfer`: the seller records an offer; it is not consent (ruling D3, F7).
contract OfferTransfer_Exits_Unit_Concrete_Test is Exits_Test {
    function test_WhenTheBuyerOrTokenIsZero() external {
        // it should revert with ZeroAddress
        vm.expectRevert(IExits.ZeroAddress.selector);
        exits.offerTransfer(COMMON, address(0), 1, 1, address(usdc), DOC);
        vm.expectRevert(IExits.ZeroAddress.selector);
        exits.offerTransfer(COMMON, users.investor, 1, 1, address(0), DOC);
    }

    function test_WhenTheOfferHasZeroShares() external {
        vm.expectRevert(IPayments.ZeroAmount.selector);
        vm.prank(users.ben);
        exits.offerTransfer(COMMON, users.investor, 0, 1, address(usdc), DOC);
    }

    function test_WhenTheOfferHasZeroPrice() external {
        vm.expectRevert(IPayments.ZeroAmount.selector);
        vm.prank(users.ben);
        exits.offerTransfer(COMMON, users.investor, 1, 0, address(usdc), DOC);
    }

    function test_WhenTheOfferHasNoDocumentHash() external {
        vm.expectRevert(IPayments.ZeroDocumentHash.selector);
        vm.prank(users.ben);
        exits.offerTransfer(COMMON, users.investor, 1, 1, address(usdc), bytes32(0));
    }

    function test_WhenTheSellerOffersASale() external {
        // it should record the offer with the caller as the seller
        // it should not move shares or money
        // it should not count as the seller's consent
        // it should return the transfer id
        // it should emit TransferOffered
        uint256 benUsdc = usdc.balanceOf(users.ben);
        uint256 investorUsdc = usdc.balanceOf(users.investor);

        vm.expectEmit(true, true, true, true, address(exits));
        emit IExits.TransferOffered(1, users.ben, users.investor, COMMON, 400, 1.5e6, address(usdc), DOC);
        vm.prank(users.ben);
        uint256 id = exits.offerTransfer(COMMON, users.investor, 400, 1.5e6, address(usdc), DOC);

        assertEq(id, 1, "ids start at 1, so 0 is never an offer");
        IExits.Transfer memory t = exits.transfer(id);
        assertEq(t.seller, users.ben, "the caller is the seller");
        assertEq(t.buyer, users.investor, "buyer");
        assertEq(t.classId, COMMON, "class");
        assertEq(t.shares, 400, "shares");
        assertEq(t.price, 1.5e6, "price");
        assertEq(t.token, address(usdc), "token");
        assertEq(t.documentHash, DOC, "document");
        assertFalse(t.approved, "not approved");
        assertFalse(t.bought, "not bought");

        assertEq(captable.tokenOf(COMMON).balanceOf(users.ben), 3000, "no shares moved");
        assertEq(captable.tokenOf(COMMON).balanceOf(users.investor), 0, "no shares moved");
        assertEq(usdc.balanceOf(users.ben), benUsdc, "no money moved");
        assertEq(usdc.balanceOf(users.investor), investorUsdc, "no money moved");
        bytes32 consentId = keccak256(abi.encode(COMMON, users.ben, users.investor, uint128(400), DOC));
        assertFalse(captable.transferConsent(consentId), "an offer is not consent");

        vm.prank(users.eve);
        assertEq(exits.offerTransfer(COMMON, users.investor, 1, 1, address(usdc), DOC), 2, "the next id");
    }
}
