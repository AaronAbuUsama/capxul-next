// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IRounds } from "../../../../src/interfaces/IRounds.sol";
import { MockERC20 } from "../../../mocks/MockERC20.sol";
import { Rounds_Shared_Test } from "../../../utils/Rounds/Rounds_Shared_Test.sol";

/// @dev `pay` over the whole `uint128` range of shares and price (R1, ruling D14): the investor pays exactly
/// `shares * price`, the Safe receives exactly that, the investor receives exactly `shares` in the same call, and
/// Rounds holds nothing. And over the paying time against `payBy` (R3).
contract Pay_Rounds_Unit_Fuzz_Test is Rounds_Shared_Test {
    function testFuzz_Pay_IsExact(uint128 shares, uint128 price) external {
        shares = uint128(bound(shares, 1, type(uint128).max));
        price = uint128(bound(price, 1, type(uint128).max));
        uint256 amount = uint256(shares) * price;
        MockERC20 token = new MockERC20("Token", "TKN", 6);
        uint8 classId = captable.createClass("Fuzz", type(uint128).max, 0, 0, address(0));
        vm.prank(address(safe));
        uint256 id = rounds.createPricedRound(classId, address(token), price, shares, _now() + PAY_WINDOW, ROUND_DOC);
        _invite(id, users.investor, type(uint128).max);
        _commit(id, users.investor, type(uint128).max);
        _allocate(id, users.investor, shares);
        token.mint(users.investor, amount);
        vm.prank(users.investor);
        token.approve(address(rounds), type(uint256).max);

        _pay(id, users.investor);
        assertEq(token.balanceOf(users.investor), 0, "paid exactly shares x price");
        assertEq(token.balanceOf(address(safe)), amount, "the Safe got exactly shares x price");
        assertEq(_token(classId).balanceOf(users.investor), shares, "exactly the shares");
        assertEq(rounds.pricedRound(id).issuedShares, shares, "round issued");
        assertEq(token.balanceOf(address(rounds)), 0, "holds nothing");
    }

    function testFuzz_Pay_OnlyUntilPayBy(uint64 dt) external {
        uint256 id = _defaultAllocated();
        uint64 payBy = rounds.pricedRound(id).payBy;
        vm.warp(bound(dt, _now(), uint256(payBy) + 365 days));
        if (_now() > payBy) vm.expectRevert(abi.encodeWithSelector(IRounds.PayByPassed.selector, payBy));
        vm.prank(users.investor);
        rounds.pay(id);
        assertEq(_token(SERIES_C).balanceOf(users.investor), _now() > payBy ? 0 : SHARES, "issued only in time");
    }
}
