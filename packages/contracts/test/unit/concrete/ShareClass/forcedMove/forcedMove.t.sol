// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IShareClass } from "../../../../../src/interfaces/IShareClass.sol";
import { MockCaptableForShareClass } from "../../../../utils/ShareClass/MockCaptableForShareClass.sol";
import { ShareClass_Shared_Test } from "../../../../utils/ShareClass/ShareClass_Shared_Test.sol";

/// @dev Ports Firm EquityToken.t.sol:45-47 and 63-64 (T-3, T-4).
contract ForcedMove_ShareClass_Unit_Concrete_Test is ShareClass_Shared_Test {
    function test_WhenTheCallerIsNotTheCaptable() external {
        _mint(users.alice, 10);
        // it should revert with OnlyCaptable
        vm.expectRevert(IShareClass.OnlyCaptable.selector);
        vm.prank(users.eve);
        token.forcedMove(users.alice, users.eve, 10);
        vm.expectRevert(IShareClass.OnlyCaptable.selector);
        vm.prank(address(safe));
        token.forcedMove(users.alice, address(safe), 10);
        assertEq(token.balanceOf(users.alice), 10, "balance kept");
    }

    modifier whenTheCallerIsTheCaptable() {
        _;
    }

    function test_WhenTheCallerIsTheCaptable() external whenTheCallerIsTheCaptable {
        _mint(users.alice, 1000);
        // The rule would refuse an ordinary transfer; a Captable move skips it (T-4).
        captable.setAnswer(MockCaptableForShareClass.Answer.NotAllowed, 0);
        // it should move the balance without calling checkTransfer
        _expectNoTransferCheck();
        _forcedMove(users.alice, users.bob, 300);
        assertEq(token.balanceOf(users.alice), 700, "alice balance");
        assertEq(token.balanceOf(users.bob), 300, "bob balance");
        assertEq(token.totalSupply(), 1000, "supply unchanged");
        // it should move the delegated votes
        assertEq(token.getVotes(users.alice), 700, "alice votes");
        assertEq(token.getVotes(users.bob), 300, "bob votes");
    }

    function test_GivenTheSharesLeaveTheSafe() external whenTheCallerIsTheCaptable {
        uint256 t0 = vm.getBlockTimestamp();
        _mint(address(safe), 1000);
        vm.warp(t0 + 1 days);
        _forcedMove(address(safe), users.investor, 400);
        // it should checkpoint the Safe's lower balance
        assertEq(token.safeBalanceAt(vm.getBlockTimestamp()), 600, "safe balance now");
        assertEq(token.safeBalanceAt(t0), 1000, "safe balance at t0");
        // it should self delegate the new holder on first receipt
        assertEq(token.delegates(users.investor), users.investor, "investor delegate");
        assertEq(token.getVotes(users.investor), 400, "investor votes");
        assertEq(token.getVotes(address(safe)), 0, "safe votes");
    }

    function test_GivenTheSharesGoToTheSafe() external whenTheCallerIsTheCaptable {
        uint256 t0 = vm.getBlockTimestamp();
        _mint(users.alice, 1000);
        vm.warp(t0 + 1 days);
        _forcedMove(users.alice, address(safe), 250);
        // it should checkpoint the Safe's higher balance and give it no votes
        assertEq(token.safeBalanceAt(vm.getBlockTimestamp()), 250, "safe balance now");
        assertEq(token.safeBalanceAt(t0), 0, "safe balance at t0");
        assertEq(token.delegates(address(safe)), address(0), "safe delegate");
        assertEq(token.getVotes(address(safe)), 0, "safe votes");
        assertEq(token.getVotes(users.alice), 750, "alice votes");
        assertEq(token.totalSupply(), 1000, "supply unchanged");
    }
}
