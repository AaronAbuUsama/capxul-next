// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IRounds } from "../../../../../src/interfaces/IRounds.sol";
import { Rounds_Shared_Test } from "../../../../utils/Rounds/Rounds_Shared_Test.sol";

/// @dev spec/rounds.md `allocate` (Board only, H4): whole shares, `allocatedShares + shares <= maxShares`
/// (`OverAllocated(left, requested)`). Allocation issues nothing and moves no money; a second allocation to the
/// same investor adds to the first.
contract Allocate_Rounds_Unit_Concrete_Test is Rounds_Shared_Test {
    function test_WhenTheCallerIsNotTheSafe() external {
        // it should revert with OnlyBoard
        uint256 id = _createPricedRound(SERIES_C, PRICE, MAX_SHARES);
        _invite(id, users.investor, INVITED);
        _commit(id, users.investor, INVITED);
        vm.expectRevert(IRounds.OnlyBoard.selector);
        vm.prank(users.investor);
        rounds.allocate(id, users.investor, SHARES);
        vm.expectRevert(IRounds.OnlyBoard.selector);
        vm.prank(users.eve);
        rounds.allocate(id, users.eve, SHARES);
    }

    function test_WhenTheInvestorHasNotCommitted() external {
        // it should revert with NotInvited
        uint256 id = _createPricedRound(SERIES_C, PRICE, MAX_SHARES);
        vm.expectRevert(IRounds.NotInvited.selector);
        vm.prank(address(safe));
        rounds.allocate(id, users.investor, SHARES); // never invited
        _invite(id, users.investor, INVITED);
        vm.expectRevert(IRounds.NotInvited.selector);
        vm.prank(address(safe));
        rounds.allocate(id, users.investor, SHARES); // invited, not committed
    }

    function test_WhenTheInvestorAlreadyPaid() external {
        // it should revert with AlreadyPaid
        uint256 id = _defaultAllocated();
        _pay(id, users.investor);
        vm.expectRevert(IRounds.AlreadyPaid.selector);
        vm.prank(address(safe));
        rounds.allocate(id, users.investor, 1);
        assertEq(rounds.position(id, users.investor).shares, SHARES, "the paid position is unchanged");
        assertEq(rounds.pricedRound(id).allocatedShares, SHARES, "the round's allocation is unchanged");
    }

    function test_WhenTheSharesWouldTakeTheRoundPastItsMaximum() external {
        // it should revert with OverAllocated
        uint256 id = _createPricedRound(SERIES_C, PRICE, MAX_SHARES);
        _invite(id, users.investor, INVITED);
        _commit(id, users.investor, INVITED);
        vm.expectRevert(abi.encodeWithSelector(IRounds.OverAllocated.selector, MAX_SHARES, MAX_SHARES + 1));
        vm.prank(address(safe));
        rounds.allocate(id, users.investor, MAX_SHARES + 1);

        _allocate(id, users.investor, SHARES);
        _invite(id, angel, INVITED);
        _commit(id, angel, INVITED);
        uint128 left = MAX_SHARES - SHARES;
        vm.expectRevert(abi.encodeWithSelector(IRounds.OverAllocated.selector, left, left + 1));
        vm.prank(address(safe));
        rounds.allocate(id, angel, left + 1);
        assertEq(rounds.pricedRound(id).allocatedShares, SHARES, "unchanged");
    }

    function test_WhenTheAllocationFits() external {
        // it should record the investor's shares
        // it should add them to the round's allocated shares
        // it should emit Allocated
        uint256 id = _createPricedRound(SERIES_C, PRICE, MAX_SHARES);
        _invite(id, users.investor, INVITED);
        _commit(id, users.investor, INVITED);
        _invite(id, angel, INVITED);
        _commit(id, angel, INVITED);
        _expectNoPaymentOrIssue();
        vm.expectEmit(true, true, true, true, address(rounds));
        emit IRounds.Allocated(id, users.investor, SHARES);
        vm.prank(address(safe));
        rounds.allocate(id, users.investor, SHARES);
        assertEq(rounds.position(id, users.investor).shares, SHARES, "investor's shares");
        assertEq(rounds.pricedRound(id).allocatedShares, SHARES, "round allocated");

        uint128 rest = MAX_SHARES - SHARES - 1;
        vm.prank(address(safe));
        rounds.allocate(id, angel, rest);
        vm.prank(address(safe));
        rounds.allocate(id, users.investor, 1); // the round's last share, added to the first allocation
        assertEq(rounds.position(id, users.investor).shares, SHARES + 1, "added");
        assertEq(rounds.position(id, angel).shares, rest, "angel's shares");
        assertEq(rounds.pricedRound(id).allocatedShares, MAX_SHARES, "the round is full");
        assertEq(rounds.pricedRound(id).issuedShares, 0, "nothing issued");
        assertEq(_token(SERIES_C).totalSupply(), 0, "no shares exist yet");
        _assertHoldsNothing();
    }
}
