// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IRounds } from "../../../../../src/interfaces/IRounds.sol";
import { Rounds_Shared_Test } from "../../../../utils/Rounds/Rounds_Shared_Test.sol";

/// @dev spec/rounds.md `invite` (Board only, H4). The closed round here is priced above every earlier class, so
/// closing it needs no consent and adjusts nothing.
contract Invite_Rounds_Unit_Concrete_Test is Rounds_Shared_Test {
    uint128 internal constant UP_PRICE = 3_000_000;

    function test_WhenTheRoundDoesNotExist() external {
        // it should reject the unknown round
        vm.expectRevert(abi.encodeWithSelector(IRounds.InvalidRound.selector, "unknown round"));
        vm.prank(address(safe));
        rounds.invite(1, users.investor, INVITED);
    }

    function test_WhenTheCallerIsNotTheSafe() external {
        // it should revert with OnlyBoard
        uint256 id = _createPricedRound(SERIES_C, PRICE, MAX_SHARES);
        vm.expectRevert(IRounds.OnlyBoard.selector);
        vm.prank(users.eve);
        rounds.invite(id, users.eve, INVITED);
        assertEq(rounds.position(id, users.eve).maxAmount, 0, "no invitation");
    }

    function test_WhenTheRoundIsClosed() external {
        // it should revert with RoundIsClosed
        uint256 id = _createPricedRound(SERIES_C, UP_PRICE, MAX_SHARES);
        vm.warp(rounds.pricedRound(id).payBy + 1);
        _close(id, 0);
        vm.expectRevert(IRounds.RoundIsClosed.selector);
        vm.prank(address(safe));
        rounds.invite(id, users.investor, INVITED);
    }

    function test_WhenTheRoundIsCancelled() external {
        // it should revert with RoundIsCancelled
        uint256 id = _createPricedRound(SERIES_C, PRICE, MAX_SHARES);
        vm.prank(address(safe));
        rounds.cancel(id);
        vm.expectRevert(IRounds.RoundIsCancelled.selector);
        vm.prank(address(safe));
        rounds.invite(id, users.investor, INVITED);
    }

    function test_WhenTheRoundIsOpen() external {
        // it should record the investor's maximum
        uint256 id = _createPricedRound(SERIES_C, PRICE, MAX_SHARES);
        vm.expectEmit(true, true, true, true, address(rounds));
        emit IRounds.Invited(id, users.investor, INVITED);
        _invite(id, users.investor, INVITED);
        IRounds.Position memory p = rounds.position(id, users.investor);
        assertEq(p.maxAmount, INVITED, "maximum");
        assertEq(p.committed, 0, "no commitment");
        assertEq(p.shares, 0, "no allocation");
        assertFalse(p.paid, "not paid");
        _invite(id, users.investor, INVITED / 2);
        assertEq(rounds.position(id, users.investor).maxAmount, INVITED / 2, "a second invitation replaces it");
        _assertHoldsNothing();
    }
}
