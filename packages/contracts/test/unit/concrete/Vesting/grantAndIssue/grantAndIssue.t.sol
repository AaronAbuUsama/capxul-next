// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC5805 } from "@openzeppelin/contracts/interfaces/IERC5805.sol";

import { ICaptable } from "../../../../../src/interfaces/ICaptable.sol";
import { IVesting } from "../../../../../src/interfaces/IVesting.sol";
import { Vesting_Shared_Test } from "../../../../utils/Vesting/Vesting_Shared_Test.sol";

/// @dev Ports Firm VestingController.t.sol:34-37 (V-1, now the Safe), 39-57 (grant recorded), 59-64 (V-3) and
/// 66-86 (V-2).
contract GrantAndIssue_Vesting_Unit_Concrete_Test is Vesting_Shared_Test {
    function test_WhenTheCallerIsNotTheCaptablesSafe() external {
        // it should revert with OnlyBoard
        address[3] memory callers = [address(users.eve), exits, address(users.amira)];
        for (uint256 i; i < callers.length; ++i) {
            vm.expectRevert(IVesting.OnlyBoard.selector);
            vm.prank(callers[i]);
            vesting.grantAndIssue(address(captable), COMMON, users.amira, AMOUNT, gStart, gCliff, gEnd, true, DOC);
        }
    }

    function test_WhenTheAmountIs0() external {
        // it should revert with InvalidSchedule
        vm.expectRevert(IVesting.InvalidSchedule.selector);
        _grant(users.amira, 0, gStart, gCliff, gEnd, true);
    }

    function test_WhenTheScheduleIsNotStartThenCliffThenEnd() external {
        // it should revert with InvalidSchedule
        // The cliff before the start.
        vm.expectRevert(IVesting.InvalidSchedule.selector);
        _grant(users.amira, AMOUNT, gCliff, gCliff - 1, gEnd, true);
        // The cliff after the end.
        vm.expectRevert(IVesting.InvalidSchedule.selector);
        _grant(users.amira, AMOUNT, gStart, gEnd + 1, gEnd, true);
        // The end before the start.
        vm.expectRevert(IVesting.InvalidSchedule.selector);
        _grant(users.amira, AMOUNT, gEnd, gEnd, gStart, true);
    }

    function test_WhenTheScheduleIsUnderOneMonthAndTheCliffIsNotTheEnd() external {
        // it should revert with InvalidSchedule
        // 1 to 31 January: no whole month step, and the cliff is not the end.
        vm.expectRevert(IVesting.InvalidSchedule.selector);
        _grant(users.amira, AMOUNT, gStart, gStart, _date(2026, 1, 31), true);
        // One second short of the first step.
        vm.expectRevert(IVesting.InvalidSchedule.selector);
        _grant(users.amira, AMOUNT, gStart, gStart + 1 days, _date(2026, 2, 1) - 1, true);
    }

    function test_WhenTheShareholderAlreadyHasALiveGrantOnThisClass() external {
        // it should revert with GrantExists
        uint256 id = _defaultGrant(users.amira);
        vm.expectRevert(abi.encodeWithSelector(IVesting.GrantExists.selector, id));
        _defaultGrant(users.amira);
        // The second grant issued nothing.
        assertEq(_balance(users.amira), AMOUNT, "balance");
    }

    modifier whenTheCaptableRefusesTheIssue() {
        _;
    }

    function test_GivenTheClassIsOverItsAuthorised() external whenTheCaptableRefusesTheIssue {
        // it should revert with AuthorisedExceeded and record no grant
        _issue(users.ben, AUTHORISED - 10);
        vm.expectRevert(
            abi.encodeWithSelector(ICaptable.AuthorisedExceeded.selector, COMMON, AUTHORISED, AUTHORISED - 10, 11)
        );
        _grant(users.amira, 11, gStart, gCliff, gEnd, true);
        assertEq(vesting.grantOf(address(captable), COMMON, users.amira), 0, "grantOf");
        vm.expectRevert(abi.encodeWithSelector(IVesting.UnknownGrant.selector, 1));
        vesting.getGrant(1);
        // Ten shares still fit: the refusal was the Captable's, not Vesting's.
        uint256 id = _grant(users.amira, 10, gStart, gCliff, gEnd, true);
        assertEq(id, 1, "first id");
    }

    function test_GivenAProposalIsPendingInTheClass() external whenTheCaptableRefusesTheIssue {
        // it should revert with ProposalPending and record no grant
        uint48 until = uint48(block.timestamp + 1 days);
        captable.setPendingUntil(COMMON, until);
        vm.expectRevert(abi.encodeWithSelector(ICaptable.ProposalPending.selector, COMMON, until));
        _defaultGrant(users.amira);
        assertEq(vesting.grantOf(address(captable), COMMON, users.amira), 0, "grantOf");
        vm.expectRevert(abi.encodeWithSelector(IVesting.UnknownGrant.selector, 1));
        vesting.getGrant(1);
        assertEq(_balance(users.amira), 0, "balance");
    }

    function test_WhenTheGrantIsValid() external {
        uint128 allowanceBefore = captable.issuerAllowance(address(vesting), COMMON);
        IVesting.Grant memory expected = _liveGrant(users.amira, AMOUNT, gStart, gCliff, gEnd, true);

        // it should issue the amount of new shares to the shareholder under Vesting's issuer allowance
        vm.expectCall(address(captable), abi.encodeWithSelector(ICaptable.issue.selector, COMMON, users.amira, AMOUNT));
        // it should emit Granted
        vm.expectEmit(true, true, true, true, address(vesting));
        emit IVesting.Granted(address(safe), 1, users.amira, expected);
        uint256 id = _defaultGrant(users.amira);

        assertEq(id, 1, "ids start at 1");
        assertEq(_balance(users.amira), AMOUNT, "balance");
        assertEq(captable.issued(COMMON), AMOUNT, "issued");
        assertEq(captable.issuerAllowance(address(vesting), COMMON), allowanceBefore - AMOUNT, "allowance used");

        // it should record an accepted grant in the same call
        _assertGrant(vesting.getGrant(id), expected);
        assertEq(vesting.grantOf(address(captable), COMMON, users.amira), id, "grantOf");

        // it should lock the whole amount until the cliff
        assertEq(_locked(users.amira, _now()), AMOUNT, "locked now");
        assertEq(_locked(users.amira, gCliff - 1), AMOUNT, "locked before the cliff");
        assertLt(_locked(users.amira, gCliff), AMOUNT, "unlocks at the cliff");

        // it should leave the shareholder's votes on all their shares
        assertEq(IERC5805(address(_token(COMMON))).getVotes(users.amira), AMOUNT, "votes");
    }
}
