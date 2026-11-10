// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IExits } from "../../../../src/interfaces/IExits.sol";
import { Exits_Test } from "../../../utils/Exits/Exits_Test.sol";

/// @dev Fuzz of `settle` (spec/exits.md; X1, X2, X3, X4, H4). Ranges: proceeds from $1 to $1 billion in USDC
/// units; any subset of the four payouts paid into claim escrows; any caller other than the Safe refused.
contract Settle_Exits_Unit_Fuzz_Test is Exits_Test {
    function testFuzz_SettleAnyProceedsAndClaims(uint256 proceeds, uint8 mask) external {
        proceeds = bound(proceeds, 1e6, 1_000_000_000e6);
        usdc.mint(address(safe), proceeds); // the Safe holds the buyer's payment (setUp funds it with only $2m)
        _approveSale(address(usdc), proceeds);
        IExits.Holding[] memory h = _holdings();
        IExits.Payout[] memory p = exits.preview(SALE, h);
        uint256[] memory amounts = new uint256[](4);
        uint256 n;
        for (uint256 i; i < 4; ++i) {
            amounts[i] = p[i].amount;
            if (mask & (1 << i) != 0 && amounts[i] != 0) ++n;
        }
        uint256[] memory claims = new uint256[](n);
        n = 0;
        for (uint256 i; i < 4; ++i) {
            if (mask & (1 << i) != 0 && amounts[i] != 0) claims[n++] = i;
        }
        uint256 safeBefore = usdc.balanceOf(address(safe));
        _payBatch(address(usdc), h, amounts, claims);
        vm.prank(address(safe));
        exits.settle(SALE, h, claims);

        assertEq(safeBefore - usdc.balanceOf(address(safe)), proceeds, "X1: the batch paid exactly the proceeds");
        assertEq(captable.tokenOf(COMMON).totalSupply() + captable.tokenOf(SERIES_A).totalSupply(), 0, "X2 shares");
        assertEq(options.allocated(), 0, "X2 options");
        assertEq(usdc.balanceOf(address(exits)), 0, "X3: Exits holds nothing");
        for (uint256 i; i < 4; ++i) {
            IExits.Claim memory c = exits.claimOf(SALE, i);
            if (_contains(claims, i)) {
                assertEq(c.payee, h[i].payee, "claim recorded for its payee");
                assertEq(c.amount, amounts[i], "claim amount");
                assertEq(usdc.balanceOf(c.escrow), amounts[i], "X3: the escrow holds exactly its amount");
            } else {
                assertEq(c.payee, address(0), "no claim");
            }
        }
    }

    function testFuzz_H4_OnlyTheSafeSettles(address caller) external {
        vm.assume(caller != address(safe));
        _approveSale(address(usdc), PROCEEDS);
        _payBatch(address(usdc), _holdings(), _payouts(), _none());
        vm.expectRevert(IExits.OnlyBoard.selector);
        vm.prank(caller);
        exits.settle(SALE, _holdings(), _none());
    }
}
