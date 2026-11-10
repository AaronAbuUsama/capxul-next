// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IExits } from "../../../../../src/interfaces/IExits.sol";
import { IPayments } from "../../../../../src/interfaces/IPayments.sol";
import { Exits_Test } from "../../../../utils/Exits/Exits_Test.sol";

/// @dev spec/exits.md `approveSale` (the company Governor; a sale id is used once); ruling J4 (the sale token
/// must have the 6 decimals preferences are priced in).
contract ApproveSale_Exits_Unit_Concrete_Test is Exits_Test {
    function test_WhenTheSaleTokenIsZero() external {
        // it should revert with ZeroAddress
        vm.expectRevert(IExits.ZeroAddress.selector);
        vm.prank(governor);
        exits.approveSale(SALE, address(0), PROCEEDS, TERMS);
    }

    function test_WhenTheCallerIsNotTheCompanyGovernor() external {
        // it should revert with OnlyGovernor
        vm.expectRevert(IExits.OnlyGovernor.selector);
        vm.prank(users.eve);
        exits.approveSale(SALE, address(usdc), PROCEEDS, TERMS);
        vm.expectRevert(IExits.OnlyGovernor.selector);
        vm.prank(address(safe)); // the Board alone cannot sell the company (Q4)
        exits.approveSale(SALE, address(usdc), PROCEEDS, TERMS);
    }

    function test_WhenTheSaleIdWasAlreadyUsed() external {
        // it should revert with SaleExists
        _approveSale(address(usdc), PROCEEDS);
        vm.expectRevert(abi.encodeWithSelector(IExits.SaleExists.selector, SALE));
        vm.prank(governor);
        exits.approveSale(SALE, address(usdc), 1, keccak256("other terms"));
        assertEq(exits.sale(SALE).proceeds, PROCEEDS, "the first approval stands");
    }

    function test_WhenTheSaleTokensDecimalsAreNot6() external {
        // it should revert with InvalidSaleToken
        // J4: InvalidSaleToken is not yet in IExits (reported as a question); matched by its signature.
        vm.expectRevert(abi.encodeWithSignature("InvalidSaleToken(address)", address(dai)));
        vm.prank(governor);
        exits.approveSale(SALE, address(dai), PROCEEDS, TERMS);

        // A "token" with no code has no decimals either: refused the same way, not with an empty revert.
        address noCode = makeAddr("not a token");
        vm.expectRevert(abi.encodeWithSignature("InvalidSaleToken(address)", noCode));
        vm.prank(governor);
        exits.approveSale(SALE, noCode, PROCEEDS, TERMS);

        address oversized = address(new OversizedDecimals());
        vm.expectRevert(abi.encodeWithSignature("InvalidSaleToken(address)", oversized));
        vm.prank(governor);
        exits.approveSale(SALE, oversized, PROCEEDS, TERMS);
    }

    function test_WhenAPaidSaleHasNoTermsHash() external {
        vm.expectRevert(IPayments.ZeroDocumentHash.selector);
        vm.prank(governor);
        exits.approveSale(SALE, address(usdc), PROCEEDS, bytes32(0));
        assertEq(exits.sale(SALE).token, address(0), "sale id remains available");
    }

    function test_WhenAZeroProceedsSaleHasNoTermsHash() external {
        vm.prank(governor);
        exits.approveSale(SALE, address(usdc), 0, bytes32(0));
        assertEq(exits.sale(SALE).token, address(usdc), "zero-proceeds sale approved");
    }

    function test_WhenAPassedProposalApprovesASale() external {
        // it should record the token and the proceeds and the terms hash
        // it should emit SaleApproved
        vm.expectEmit(address(exits));
        emit IExits.SaleApproved(SALE, address(usdc), PROCEEDS, TERMS);
        _approveSale(address(usdc), PROCEEDS);

        IExits.Sale memory s = exits.sale(SALE);
        assertEq(s.token, address(usdc), "token");
        assertEq(s.proceeds, PROCEEDS, "proceeds");
        assertEq(s.termsHash, TERMS, "terms hash");
        assertFalse(s.settled, "not settled");
    }
}

contract OversizedDecimals {
    function decimals() external pure returns (uint256) {
        return 256;
    }
}
