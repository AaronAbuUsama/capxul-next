// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IVotes } from "@openzeppelin/contracts/governance/utils/IVotes.sol";

import { IShareClass } from "../../../../../src/interfaces/IShareClass.sol";
import { ShareClass_Shared_Test } from "../../../../utils/ShareClass/ShareClass_Shared_Test.sol";

/// @dev D5: nobody lends votes to the Board, and the Safe never delegates.
contract Delegate_ShareClass_Unit_Concrete_Test is ShareClass_Shared_Test {
    function test_WhenTheDelegatorIsTheSafe() external {
        _mint(address(safe), 100);
        // it should revert with SafeCannotVote
        vm.expectRevert(IShareClass.SafeCannotVote.selector);
        vm.prank(address(safe));
        token.delegate(users.alice);
        vm.expectRevert(IShareClass.SafeCannotVote.selector);
        vm.prank(address(safe));
        token.delegate(address(safe));
        assertEq(token.getVotes(users.alice), 0, "alice got no votes");
        assertEq(token.delegates(address(safe)), address(0), "safe still has no delegate");
    }

    modifier whenTheDelegateeIsTheSafe() {
        _;
    }

    function test_GivenItIsDelegate() external whenTheDelegateeIsTheSafe {
        _mint(users.alice, 100);
        // it should revert with SafeCannotVote
        vm.expectRevert(IShareClass.SafeCannotVote.selector);
        vm.prank(users.alice);
        token.delegate(address(safe));
        assertEq(token.getVotes(address(safe)), 0, "safe votes");
        assertEq(token.getVotes(users.alice), 100, "alice keeps her votes");
    }

    function test_GivenItIsDelegateBySig() external whenTheDelegateeIsTheSafe {
        (address signer, uint256 key) = makeAddrAndKey("signer");
        _mint(signer, 100);
        uint256 expiry = vm.getBlockTimestamp() + 1 days;
        (uint8 v, bytes32 r, bytes32 s) = _delegationSig(key, address(safe), 0, expiry);
        // it should revert with SafeCannotVote
        vm.expectRevert(IShareClass.SafeCannotVote.selector);
        vm.prank(users.eve);
        token.delegateBySig(address(safe), 0, expiry, v, r, s);
        assertEq(token.getVotes(address(safe)), 0, "safe votes");
        assertEq(token.getVotes(signer), 100, "signer keeps the votes");
    }

    function test_WhenNeitherIsTheSafe() external {
        _mint(users.alice, 100);
        // it should emit DelegateChanged
        vm.expectEmit(address(token));
        emit IVotes.DelegateChanged(users.alice, users.alice, users.bob);
        vm.prank(users.alice);
        token.delegate(users.bob);
        // it should move the delegator's votes to the delegatee
        assertEq(token.delegates(users.alice), users.bob, "delegate");
        assertEq(token.getVotes(users.alice), 0, "alice votes");
        assertEq(token.getVotes(users.bob), 100, "bob votes");
    }
}
