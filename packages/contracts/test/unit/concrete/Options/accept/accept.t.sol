// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IOptions } from "../../../../../src/interfaces/IOptions.sol";
import { Options_Shared_Test } from "../../../../utils/Options/Options_Shared_Test.sol";

/// @dev spec/options.md `accept`; ruling Q18.1 (the grantee signs the exact terms) and F7 (an on-chain call from
/// the grantee's own Safe). Shaped as Vesting `acceptGrant` (spec/vesting.md).
contract Accept_Options_Unit_Concrete_Test is Options_Shared_Test {
    function test_WhenTheCallerIsNotTheGrantee() external {
        // it should revert with OnlyGrantee
        uint256 id = _defaultGrant();
        vm.expectRevert(IOptions.OnlyGrantee.selector);
        vm.prank(users.eve);
        options.accept(id, DOC);
        vm.expectRevert(IOptions.OnlyGrantee.selector);
        vm.prank(address(safe));
        options.accept(id, DOC);
        assertFalse(options.getGrant(id).accepted, "not accepted");
    }

    function test_WhenTheOfferHasExpired() external {
        // it should revert with OfferExpired
        uint256 id = _defaultGrant();
        vm.warp(options.getGrant(id).offerExpiresAt + 1);
        vm.expectRevert(IOptions.OfferExpired.selector);
        vm.prank(users.alice);
        options.accept(id, DOC);
        assertFalse(options.getGrant(id).accepted, "not accepted");
    }

    function test_WhenTheTermsHashIsNotTheDocumentHash() external {
        // it should revert with TermsMismatch
        uint256 id = _defaultGrant();
        vm.expectRevert(IOptions.TermsMismatch.selector);
        vm.prank(users.alice);
        options.accept(id, keccak256("option agreement: Alice, 300,000 Common at $0.01"));
        assertFalse(options.getGrant(id).accepted, "not accepted");
    }

    function test_WhenTheGranteeAcceptsTheExactTermsInTime() external {
        // it should mark the grant accepted
        // it should emit OptionsAccepted
        uint256 id = _defaultGrant();
        IOptions.OptionGrant memory expected = options.getGrant(id);
        expected.accepted = true;
        vm.warp(expected.offerExpiresAt); // the last moment the offer is open
        vm.expectEmit(address(options));
        emit IOptions.OptionsAccepted(id, users.alice);
        vm.prank(users.alice);
        options.accept(id, DOC);
        _assertGrant(options.getGrant(id), expected);
        assertEq(options.allocated(), SHARES, "allocated unchanged");
    }
}
