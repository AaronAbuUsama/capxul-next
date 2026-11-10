// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IShareClass } from "../../../../../src/interfaces/IShareClass.sol";
import { ShareClass_Shared_Test } from "../../../../utils/ShareClass/ShareClass_Shared_Test.sol";

/// @dev Ports Firm EquityToken.t.sol:36-41 and 52-58 (T-3).
contract Mint_ShareClass_Unit_Concrete_Test is ShareClass_Shared_Test {
    function test_WhenTheCallerIsNotTheCaptable() external {
        // it should revert with OnlyCaptable
        vm.expectRevert(IShareClass.OnlyCaptable.selector);
        vm.prank(users.eve);
        token.mint(users.eve, 1);
        // Not even the Board.
        vm.expectRevert(IShareClass.OnlyCaptable.selector);
        vm.prank(address(safe));
        token.mint(users.alice, 1);
    }

    modifier whenTheCallerIsTheCaptable() {
        _;
    }

    function test_WhenTheCallerIsTheCaptable() external whenTheCallerIsTheCaptable {
        uint256 t0 = vm.getBlockTimestamp();
        // it should mint without calling checkTransfer
        _expectNoTransferCheck();
        _mint(users.alice, 1000);
        assertEq(token.balanceOf(users.alice), 1000, "balance");
        assertEq(token.totalSupply(), 1000, "supply");
        // it should checkpoint the total supply at this timestamp
        vm.warp(t0 + 1);
        assertEq(token.getPastTotalSupply(t0), 1000, "supply at t0");
        assertEq(token.getPastTotalSupply(t0 - 1), 0, "supply before t0");
    }

    function test_GivenTheReceiverIsTheSafe() external whenTheCallerIsTheCaptable {
        uint256 t0 = vm.getBlockTimestamp();
        _mint(address(safe), 500);
        // it should checkpoint the Safe's balance
        assertEq(token.safeBalanceAt(t0), 500, "safe balance now");
        vm.warp(t0 + 1);
        assertEq(token.safeBalanceAt(t0), 500, "safe balance at t0");
        assertEq(token.safeBalanceAt(t0 - 1), 0, "safe balance before t0");
        // it should give the Safe no delegate
        assertEq(token.delegates(address(safe)), address(0), "safe delegate");
        assertEq(token.getVotes(address(safe)), 0, "safe votes");
    }
}
