// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IExits } from "../../../../src/interfaces/IExits.sol";
import { Exits_Test } from "../../../utils/Exits/Exits_Test.sol";

/// @dev Fuzz of `claim` and `redirectClaim` (spec/exits.md; X3, X4). Ranges: any nonzero `to` that is not the
/// escrow or Exits itself; any caller other than the payee or the Governor refused.
contract Claim_Exits_Unit_Fuzz_Test is Exits_Test {
    function testFuzz_X4_ClaimPaysOnceToTheNamedAddress(address to) external {
        address escrow = _settleWithInvestorClaim(address(usdc));
        vm.assume(to != address(0) && to != escrow && to != address(exits));
        uint256 before = usdc.balanceOf(to);
        vm.prank(users.investor);
        exits.claim(SALE, 2, to);
        assertEq(usdc.balanceOf(to), before + 4000e6, "the whole amount, once");
        assertEq(usdc.balanceOf(address(exits)), 0, "X3");
        vm.expectRevert(abi.encodeWithSelector(IExits.NoClaim.selector, SALE, 2));
        vm.prank(users.investor);
        exits.claim(SALE, 2, to);
    }

    function testFuzz_X4_OnlyThePayeeClaims(address caller) external {
        _settleWithInvestorClaim(address(usdc));
        vm.assume(caller != users.investor);
        vm.expectRevert(IExits.NotPayee.selector);
        vm.prank(caller);
        exits.claim(SALE, 2, caller);
    }

    function testFuzz_X4_OnlyTheGovernorRedirects(address caller, address newPayee) external {
        _settleWithInvestorClaim(address(usdc));
        vm.assume(caller != governor && newPayee != address(0));
        vm.expectRevert(IExits.OnlyGovernor.selector);
        vm.prank(caller);
        exits.redirectClaim(SALE, 2, newPayee);
    }
}
