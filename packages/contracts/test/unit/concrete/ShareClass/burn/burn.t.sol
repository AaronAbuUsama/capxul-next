// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IShareClass } from "../../../../../src/interfaces/IShareClass.sol";
import { MockCaptableForShareClass } from "../../../../utils/ShareClass/MockCaptableForShareClass.sol";
import { ShareClass_Shared_Test } from "../../../../utils/ShareClass/ShareClass_Shared_Test.sol";

/// @dev Ports Firm EquityToken.t.sol:42-43 and 60-61 (T-3).
contract Burn_ShareClass_Unit_Concrete_Test is ShareClass_Shared_Test {
    function test_WhenTheCallerIsNotTheCaptable() external {
        _mint(users.alice, 10);
        // it should revert with OnlyCaptable
        vm.expectRevert(IShareClass.OnlyCaptable.selector);
        vm.prank(users.eve);
        token.burn(users.alice, 1);
        vm.expectRevert(IShareClass.OnlyCaptable.selector);
        vm.prank(address(safe));
        token.burn(users.alice, 1);
        assertEq(token.balanceOf(users.alice), 10, "balance kept");
    }

    modifier whenTheCallerIsTheCaptable() {
        _;
    }

    function test_WhenTheCallerIsTheCaptable() external whenTheCallerIsTheCaptable {
        _mint(users.alice, 1000);
        captable.setAnswer(MockCaptableForShareClass.Answer.NotAllowed, 0);
        // it should burn without calling checkTransfer
        _expectNoTransferCheck();
        _burn(users.alice, 400);
        // it should lower the total supply and the holder's votes
        assertEq(token.balanceOf(users.alice), 600, "balance");
        assertEq(token.totalSupply(), 600, "supply");
        assertEq(token.getVotes(users.alice), 600, "votes");
    }

    function test_GivenTheHolderIsTheSafe() external whenTheCallerIsTheCaptable {
        uint256 t0 = vm.getBlockTimestamp();
        _mint(address(safe), 1000);
        vm.warp(t0 + 1 days);
        _burn(address(safe), 300);
        // it should checkpoint the Safe's lower balance
        assertEq(token.safeBalanceAt(vm.getBlockTimestamp()), 700, "safe balance now");
        assertEq(token.safeBalanceAt(t0), 1000, "safe balance at t0");
        assertEq(token.getVotes(address(safe)), 0, "safe votes");
    }
}
