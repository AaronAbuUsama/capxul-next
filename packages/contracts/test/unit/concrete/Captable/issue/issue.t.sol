// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICaptable } from "../../../../../src/interfaces/ICaptable.sol";
import { Captable_Test } from "../../../../utils/Captable/Captable_Test.sol";

contract Issue_Captable_Unit_Concrete_Test is Captable_Test {
    function test_WhenTheCallerIsNeitherTheSafeNorAModuleWithAnIssuerAllowance() external {
        // it should revert with OnlyBoard
        vm.prank(users.eve);
        vm.expectRevert(ICaptable.OnlyBoard.selector);
        captable.issue(COMMON, users.eve, 1, REASON);

        // The caller is checked first: on an unknown class too.
        vm.prank(users.eve);
        vm.expectRevert(ICaptable.OnlyBoard.selector);
        captable.issue(2, users.eve, 1, REASON);
    }

    function test_WhenTheClassDoesNotExist() external {
        // it should revert with UnknownClass
        vm.prank(address(safe));
        vm.expectRevert(abi.encodeWithSelector(ICaptable.UnknownClass.selector, uint8(2)));
        captable.issue(2, users.amira, 1, REASON);

        // A module with no allowance there learns the class is unknown, not that its allowance is short.
        vm.prank(options);
        vm.expectRevert(abi.encodeWithSelector(ICaptable.UnknownClass.selector, uint8(2)));
        captable.issue(2, users.amira, 1, REASON);
    }

    function test_WhenTheAmountIs0() external {
        // it should revert with ZeroAmount
        vm.prank(address(safe));
        vm.expectRevert(ICaptable.ZeroAmount.selector);
        captable.issue(COMMON, users.amira, 0, REASON);
    }

    function test_WhenTheCaptableIsClosedForAnExit() external {
        vm.prank(exits);
        captable.closeForExit();
        // it should revert with CaptableClosed
        vm.prank(address(safe));
        vm.expectRevert(ICaptable.CaptableClosed.selector);
        captable.issue(COMMON, users.amira, 1, REASON);

        // Checks in the spec's order: closed comes before a module's allowance.
        vm.prank(rounds);
        vm.expectRevert(ICaptable.CaptableClosed.selector);
        captable.issue(COMMON, users.amira, 1, REASON);
    }

    modifier whenTheClassVotesAndACompanyProposalIsPending() {
        governor.setPendingUntil(uint48(vm.getBlockTimestamp() + 1 days));
        _;
    }

    function test_WhenTheTimeIsAtOrBeforeTheGovernorsPendingUntil()
        external
        whenTheClassVotesAndACompanyProposalIsPending
    {
        uint48 until = governor.pendingUntil();
        // it should revert with ProposalPending with the class and the time
        vm.prank(address(safe));
        vm.expectRevert(abi.encodeWithSelector(ICaptable.ProposalPending.selector, COMMON, until));
        captable.issue(COMMON, users.amira, 1, REASON);

        // D6 comes before a module's allowance (the spec's order).
        vm.prank(options);
        vm.expectRevert(abi.encodeWithSelector(ICaptable.ProposalPending.selector, COMMON, until));
        captable.issue(COMMON, users.amira, 1, REASON);

        // At the snapshot itself it still refuses.
        vm.warp(until);
        vm.prank(address(safe));
        vm.expectRevert(abi.encodeWithSelector(ICaptable.ProposalPending.selector, SERIES_A, until));
        captable.issue(SERIES_A, users.investor, 1, REASON);
    }

    function test_WhenTheTimeIsAfterPendingUntil() external whenTheClassVotesAndACompanyProposalIsPending {
        uint48 snapshot = governor.pendingUntil();
        vm.warp(uint256(snapshot) + 1);

        // it should issue and leave the shares out of that vote
        _issue(COMMON, users.bob, 500);
        assertEq(_token(COMMON).balanceOf(users.bob), 500, "issued after the snapshot");
        assertEq(captable.getVotes(users.bob), 500, "votes from now on");
        assertEq(captable.getPastVotes(users.bob, snapshot), 0, "no votes at the snapshot");
        assertEq(captable.getPastTotalSupply(snapshot), 0, "supply at the snapshot unchanged");
    }

    function test_WhenTheClassHasAClassGovernorWithAProposalPending() external {
        vm.prank(address(governor));
        captable.setClassGovernor(COMMON, address(classGovernor));
        uint48 until = uint48(vm.getBlockTimestamp() + 1 hours);
        classGovernor.setPendingUntil(until);

        // it should revert with ProposalPending
        vm.prank(address(safe));
        vm.expectRevert(abi.encodeWithSelector(ICaptable.ProposalPending.selector, COMMON, until));
        captable.issue(COMMON, users.amira, 1, REASON);
    }

    function test_GivenTheClassHasWeight0AndACompanyProposalIsPending() external {
        uint8 nonVoting = _createClass(_params(0, 1000, 0, 0));
        governor.setPendingUntil(uint48(vm.getBlockTimestamp() + 1 days));

        // it should issue
        _issue(nonVoting, users.amira, 100);
        assertEq(_token(nonVoting).balanceOf(users.amira), 100, "a weight-0 class issues while pending");
    }

    modifier whenTheCallerMayIssueNow() {
        _;
    }

    function test_WhenAModulesAllowanceIsLessThanTheAmount() external whenTheCallerMayIssueNow {
        vm.prank(address(safe));
        captable.setIssuerAllowance(options, COMMON, 100);

        // it should revert with IssuerAllowanceExceeded
        vm.prank(options);
        vm.expectRevert(abi.encodeWithSelector(ICaptable.IssuerAllowanceExceeded.selector, options, COMMON, 100, 101));
        captable.issue(COMMON, users.alice, 101, REASON);
    }

    function test_WhenIssuedPlusConvertibleReservePlusTheAmountIsMoreThanAuthorised()
        external
        whenTheCallerMayIssueNow
    {
        // it should revert with AuthorisedExceeded
        vm.prank(address(safe));
        vm.expectRevert(
            abi.encodeWithSelector(
                ICaptable.AuthorisedExceeded.selector, SERIES_A, SERIES_A_AUTHORISED, 0, SERIES_A_AUTHORISED + 1
            )
        );
        captable.issue(SERIES_A, users.investor, SERIES_A_AUTHORISED + 1, REASON);

        // Common's 2,000,000 reserve for Series A counts against its authorised.
        uint128 room = COMMON_AUTHORISED - uint128(SERIES_A_RESERVE);
        _issue(COMMON, users.amira, room);
        vm.prank(address(safe));
        vm.expectPartialRevert(ICaptable.AuthorisedExceeded.selector);
        captable.issue(COMMON, users.amira, 1, REASON);
    }

    modifier whenItFits() {
        _;
    }

    function test_WhenItFits() external whenTheCallerMayIssueNow whenItFits {
        // it should emit Issued with the reason
        vm.expectEmit(address(captable));
        emit ICaptable.Issued(COMMON, users.amira, 5_000_000, REASON);
        _issue(COMMON, users.amira, 5_000_000);

        // it should mint the shares to the receiver
        assertEq(_token(COMMON).balanceOf(users.amira), 5_000_000, "minted to Amira");
        assertEq(_token(COMMON).totalSupply(), 5_000_000, "class supply");
    }

    function test_GivenTheCallerIsAModule() external whenTheCallerMayIssueNow whenItFits {
        vm.prank(address(safe));
        captable.setIssuerAllowance(rounds, SERIES_A, 500);

        vm.prank(rounds);
        captable.issue(SERIES_A, users.investor, 200, REASON);

        // it should lower its allowance by the amount
        assertEq(captable.issuerAllowance(rounds, SERIES_A), 300, "allowance lowered by the amount");
        assertEq(_token(SERIES_A).balanceOf(users.investor), 200, "minted to the investor");
    }

    function test_GivenTheReceiverNeverHeldThisClass() external whenTheCallerMayIssueNow whenItFits {
        _issue(COMMON, users.bob, 700);

        // it should delegate the receiver's votes to themselves
        assertEq(_token(COMMON).delegates(users.bob), users.bob, "self-delegated on first receipt");
        assertEq(_token(COMMON).getVotes(users.bob), 700, "class votes");
        assertEq(captable.getVotes(users.bob), 700, "company votes");
    }

    function test_GivenTheReceiverIsTheSafe() external whenTheCallerMayIssueNow whenItFits {
        _issue(COMMON, users.amira, 300);
        _issue(COMMON, address(safe), 1000);
        _warp(1);

        // it should mint the shares with no votes and keep them out of supply
        assertEq(_token(COMMON).balanceOf(address(safe)), 1000, "treasury shares held");
        assertEq(_token(COMMON).delegates(address(safe)), address(0), "the Safe is never delegated");
        assertEq(captable.getVotes(address(safe)), 0, "the Safe has no votes");
        assertEq(captable.getPastTotalSupply(vm.getBlockTimestamp() - 1), 300, "the Safe's shares are out of supply");
    }

    function test_GivenTheClassIsFrozen() external whenTheCallerMayIssueNow whenItFits {
        _freeze(COMMON);

        // it should still issue
        _issue(COMMON, users.amira, 10);
        assertEq(_token(COMMON).balanceOf(users.amira), 10, "a frozen class still issues");
    }
}
