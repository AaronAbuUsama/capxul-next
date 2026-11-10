// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ShareClass_Shared_Test } from "../../../../utils/ShareClass/ShareClass_Shared_Test.sol";

/// @dev Q10 changes Firm's C-13: votes follow shares by default, except the Safe's (D5).
contract DelegateOnFirstReceipt_ShareClass_Unit_Concrete_Test is ShareClass_Shared_Test {
    function test_WhenTheReceiverHasNoDelegateAndReceivesShares() external {
        _mint(users.alice, 100);
        // it should delegate the receiver to themselves
        assertEq(token.delegates(users.alice), users.alice, "alice delegate");
        assertEq(token.getVotes(users.alice), 100, "alice votes");
        // Also by an ordinary transfer.
        vm.prank(users.alice);
        token.transfer(users.bob, 30);
        assertEq(token.delegates(users.bob), users.bob, "bob delegate");
        assertEq(token.getVotes(users.bob), 30, "bob votes");
    }

    function test_WhenTheReceiverAlreadyDelegatedToSomeone() external {
        vm.prank(users.alice);
        token.delegate(users.bob);
        _mint(users.alice, 100);
        // it should keep that delegate
        assertEq(token.delegates(users.alice), users.bob, "alice keeps bob");
        assertEq(token.getVotes(users.bob), 100, "bob votes");
        assertEq(token.getVotes(users.alice), 0, "alice votes");
    }

    function test_WhenTheReceiverIsTheSafe() external {
        _mint(address(safe), 100);
        _forcedMove(address(safe), users.alice, 10);
        _forcedMove(users.alice, address(safe), 10);
        // it should leave the Safe with no delegate
        assertEq(token.delegates(address(safe)), address(0), "safe delegate");
        assertEq(token.getVotes(address(safe)), 0, "safe votes");
        assertEq(token.balanceOf(address(safe)), 100, "safe balance");
    }

    function test_WhenTheReceiverIsTheZeroAddress() external {
        _mint(users.alice, 100);
        _burn(users.alice, 100);
        // it should do nothing
        assertEq(token.delegates(address(0)), address(0), "zero address delegate");
        assertEq(token.getVotes(address(0)), 0, "zero address votes");
        assertEq(token.delegates(users.alice), users.alice, "alice delegate kept");
        assertEq(token.getVotes(users.alice), 0, "alice votes");
        assertEq(token.totalSupply(), 0, "supply");
    }
}
