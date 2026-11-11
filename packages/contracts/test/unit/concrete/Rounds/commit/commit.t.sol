// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IRounds } from "../../../../../src/interfaces/IRounds.sol";
import { Rounds_Shared_Test } from "../../../../utils/Rounds/Rounds_Shared_Test.sol";

/// @dev spec/rounds.md `commit` (decisions Q18.2: investors commit, the Board allocates, then each pays). No
/// money moves. A later commitment replaces the earlier one.
contract Commit_Rounds_Unit_Concrete_Test is Rounds_Shared_Test {
    function test_WhenTheInvestorWasNotInvited() external {
        // it should revert with NotInvited
        uint256 id = _createPricedRound(SERIES_C, PRICE, MAX_SHARES);
        vm.expectRevert(IRounds.NotInvited.selector);
        vm.prank(users.eve);
        rounds.commit(id, 1, SUBSCRIPTION);
    }

    function test_WhenTheAmountIsMoreThanTheInvitation() external {
        // it should revert with OverInvited
        uint256 id = _createPricedRound(SERIES_C, PRICE, MAX_SHARES);
        _invite(id, users.investor, INVITED);
        vm.expectRevert(abi.encodeWithSelector(IRounds.OverInvited.selector, INVITED, INVITED + 1));
        vm.prank(users.investor);
        rounds.commit(id, INVITED + 1, SUBSCRIPTION);
        assertEq(rounds.position(id, users.investor).committed, 0, "nothing committed");
    }

    function test_WhenTheInvitedInvestorCommits() external {
        // it should record the commitment and move no money
        // it should emit Committed
        uint256 id = _createPricedRound(SERIES_C, PRICE, MAX_SHARES);
        _invite(id, users.investor, INVITED);
        uint256 investorBefore = usdc.balanceOf(users.investor);
        uint256 safeBefore = usdc.balanceOf(address(safe));
        _expectNoPaymentOrIssue();
        vm.expectEmit(true, true, true, true, address(rounds));
        emit IRounds.Committed(id, users.investor, INVITED, SUBSCRIPTION);
        _commit(id, users.investor, INVITED);
        assertEq(rounds.position(id, users.investor).committed, INVITED, "committed");
        assertEq(usdc.balanceOf(users.investor), investorBefore, "no money from the investor");
        assertEq(usdc.balanceOf(address(safe)), safeBefore, "no money to the Safe");

        _commit(id, users.investor, INVITED / 4);
        assertEq(rounds.position(id, users.investor).committed, INVITED / 4, "a later commitment replaces it");
        _assertHoldsNothing();
    }
}
