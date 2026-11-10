// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IExits } from "../../../../src/interfaces/IExits.sol";
import { IPayments } from "../../../../src/interfaces/IPayments.sol";
import { Exits_Test } from "../../../utils/Exits/Exits_Test.sol";

/// @dev Fuzz of `approveSale` and `approveTransfer` access (spec/exits.md; H4) and of the sale record. Ranges:
/// any sale id, proceeds and terms; any caller other than the Governor (sales) or the Safe (transfers).
contract ApproveSale_Exits_Unit_Fuzz_Test is Exits_Test {
    function testFuzz_RecordsAnySale(uint256 saleId, uint256 proceeds, bytes32 terms) external {
        if (proceeds != 0 && terms == bytes32(0)) {
            vm.expectRevert(IPayments.ZeroDocumentHash.selector);
            vm.prank(governor);
            exits.approveSale(saleId, address(usdc), proceeds, terms);
            assertEq(exits.sale(saleId).token, address(0), "sale id remains available");
            return;
        }
        vm.prank(governor);
        exits.approveSale(saleId, address(usdc), proceeds, terms);
        IExits.Sale memory s = exits.sale(saleId);
        assertEq(s.proceeds, proceeds, "proceeds");
        assertEq(s.termsHash, terms, "terms");
        vm.expectRevert(abi.encodeWithSelector(IExits.SaleExists.selector, saleId));
        vm.prank(governor);
        exits.approveSale(saleId, address(usdc), proceeds, terms);
    }

    function testFuzz_OnlyTheGovernorApprovesASale(address caller) external {
        vm.assume(caller != governor);
        vm.expectRevert(IExits.OnlyGovernor.selector);
        vm.prank(caller);
        exits.approveSale(SALE, address(usdc), PROCEEDS, TERMS);
    }

    function testFuzz_H4_OnlyTheSafeApprovesATransfer(address caller) external {
        vm.assume(caller != address(safe));
        vm.prank(users.ben);
        uint256 id = exits.offerTransfer(COMMON, users.investor, 1, 1, address(usdc), DOC);
        vm.expectRevert(IExits.OnlyBoard.selector);
        vm.prank(caller);
        exits.approveTransfer(id);
    }
}
