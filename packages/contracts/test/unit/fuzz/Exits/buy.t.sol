// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Exits_Test } from "../../../utils/Exits/Exits_Test.sol";

/// @dev Fuzz of `buy` (spec/exits.md): delivery against payment for any size and price. Ranges: 1 to all 3,000
/// of Ben's Common; price 1 unit to $1,000,000 a share (the product fits the buyer's funded balance).
contract Buy_Exits_Unit_Fuzz_Test is Exits_Test {
    function testFuzz_PaysExactlySharesTimesPrice(uint128 shares, uint128 price) external {
        shares = uint128(bound(shares, 1, 3000));
        price = uint128(bound(price, 1, 1_000_000e6));
        uint256 amount = uint256(shares) * price;
        usdc.mint(users.investor, amount);

        vm.prank(users.ben);
        uint256 id = exits.offerTransfer(COMMON, users.investor, shares, price, address(usdc), DOC);
        vm.prank(users.ben);
        captable.consentToTransfer(COMMON, users.investor, shares, DOC);
        vm.prank(address(safe));
        exits.approveTransfer(id);
        vm.prank(users.investor);
        usdc.approve(address(exits), amount);
        uint256 ben = usdc.balanceOf(users.ben);

        vm.prank(users.investor);
        exits.buy(id);

        assertEq(usdc.balanceOf(users.ben), ben + amount, "seller paid shares x price");
        assertEq(captable.tokenOf(COMMON).balanceOf(users.investor), shares, "buyer got the shares");
        assertEq(usdc.balanceOf(address(exits)), 0, "X3");
    }
}
