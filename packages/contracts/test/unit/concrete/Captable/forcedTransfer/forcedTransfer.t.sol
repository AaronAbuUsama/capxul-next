// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ICaptable } from "../../../../../src/interfaces/ICaptable.sol";
import { Captable_Test } from "../../../../utils/Captable/Captable_Test.sol";

/// @dev Ruling D3 (R1 N-1, E7): a forced transfer is the shareholders' (Governor) or needs the shareholder's
/// own on-chain consent (F7), used up once. Common is deny-all, so every move here skips the rule.
contract ForcedTransfer_Captable_Unit_Concrete_Test is Captable_Test {
    function setUp() public override {
        super.setUp();
        try this.issueAmira() { } catch { } // red stub: each test fails on its own call
    }

    function issueAmira() external {
        _issue(COMMON, users.amira, 1000);
    }

    function test_WhenTheCallerIsNotTheCompanyGovernorNorTheSafeNorExits() external {
        // it should revert with OnlyBoard
        vm.prank(users.eve);
        vm.expectRevert(ICaptable.OnlyBoard.selector);
        captable.forcedTransfer(COMMON, users.amira, users.eve, 100, REASON);

        vm.prank(rounds);
        vm.expectRevert(ICaptable.OnlyBoard.selector);
        captable.forcedTransfer(COMMON, users.amira, users.eve, 100, REASON);

        // The caller is checked first: on an unknown class too.
        vm.prank(users.eve);
        vm.expectRevert(ICaptable.OnlyBoard.selector);
        captable.forcedTransfer(2, users.amira, users.eve, 100, REASON);
    }

    function test_WhenTheClassDoesNotExist() external {
        // it should revert with UnknownClass
        vm.prank(address(governor));
        vm.expectRevert(abi.encodeWithSelector(ICaptable.UnknownClass.selector, uint8(2)));
        captable.forcedTransfer(2, users.amira, users.bob, 100, REASON);
    }

    function test_WhenTheReasonIsZero() external {
        // it should revert with ZeroReason
        vm.prank(address(governor));
        vm.expectRevert(ICaptable.ZeroReason.selector);
        captable.forcedTransfer(COMMON, users.amira, users.bob, 100, bytes32(0));
    }

    modifier whenTheAmountWouldMoveLockedShares() {
        _lock(COMMON, users.amira, 950); // 50 unlocked
        _;
    }

    function test_GivenTheCallerIsTheCompanyGovernor() external whenTheAmountWouldMoveLockedShares {
        // it should revert with SharesLocked
        vm.prank(address(governor));
        vm.expectRevert(abi.encodeWithSelector(ICaptable.SharesLocked.selector, users.amira, uint128(950)));
        captable.forcedTransfer(COMMON, users.amira, users.bob, 51, REASON);
    }

    function test_GivenTheCallerIsTheSafeWithTheHoldersConsent() external whenTheAmountWouldMoveLockedShares {
        vm.prank(users.amira);
        captable.consentToTransfer(COMMON, users.bob, 51, REASON);

        // it should revert with SharesLocked
        vm.prank(address(safe));
        vm.expectRevert(abi.encodeWithSelector(ICaptable.SharesLocked.selector, users.amira, uint128(950)));
        captable.forcedTransfer(COMMON, users.amira, users.bob, 51, REASON);
        assertTrue(captable.transferConsent(_consentId(COMMON, users.amira, users.bob, 51, REASON)), "unused");
    }

    modifier whenTheCallerIsTheSafeOrExits() {
        _;
    }

    function test_WhenTheHolderRecordedNoConsentForTheseExactTerms() external whenTheCallerIsTheSafeOrExits {
        // Bob holds unlocked shares too, so the "other shareholder" case is refused for the consent alone,
        // whichever of the lock and consent checks runs first.
        _issue(COMMON, users.bob, 100);
        vm.prank(users.amira);
        captable.consentToTransfer(COMMON, users.bob, 100, REASON);

        // it should revert with ConsentMissing
        vm.prank(address(safe));
        vm.expectRevert(ICaptable.ConsentMissing.selector);
        captable.forcedTransfer(COMMON, users.amira, users.bob, 101, REASON); // other amount

        vm.prank(address(safe));
        vm.expectRevert(ICaptable.ConsentMissing.selector);
        captable.forcedTransfer(COMMON, users.amira, users.eve, 100, REASON); // other receiver

        vm.prank(exits);
        vm.expectRevert(ICaptable.ConsentMissing.selector);
        captable.forcedTransfer(COMMON, users.amira, users.bob, 100, keccak256("other")); // other reason

        vm.prank(address(safe));
        vm.expectRevert(ICaptable.ConsentMissing.selector);
        captable.forcedTransfer(COMMON, users.bob, users.amira, 100, REASON); // other shareholder
    }

    function test_WhenTheConsentWasAlreadyUsed() external whenTheCallerIsTheSafeOrExits {
        vm.prank(users.amira);
        captable.consentToTransfer(COMMON, users.bob, 100, REASON);
        vm.prank(address(safe));
        captable.forcedTransfer(COMMON, users.amira, users.bob, 100, REASON);

        // it should revert with ConsentMissing
        vm.prank(exits);
        vm.expectRevert(ICaptable.ConsentMissing.selector);
        captable.forcedTransfer(COMMON, users.amira, users.bob, 100, REASON);
    }

    function test_WhenTheHolderConsentedToTheseExactTerms() external whenTheCallerIsTheSafeOrExits {
        vm.prank(users.amira);
        captable.consentToTransfer(COMMON, users.bob, 100, REASON);
        bytes32 id = _consentId(COMMON, users.amira, users.bob, 100, REASON);

        // it should emit ForcedTransfer with the reason
        vm.expectEmit(address(captable));
        emit ICaptable.ForcedTransfer(COMMON, users.amira, users.bob, 100, REASON);
        vm.prank(address(safe));
        captable.forcedTransfer(COMMON, users.amira, users.bob, 100, REASON);

        // it should use up the consent
        assertFalse(captable.transferConsent(id), "consent used up");

        // it should move the shares without checking the transfer rule
        assertEq(uint8(captable.getClass(COMMON).rule), uint8(ICaptable.TransferRule.DenyAll), "deny all");
        assertEq(_token(COMMON).balanceOf(users.amira), 900, "left Amira");
        assertEq(_token(COMMON).balanceOf(users.bob), 100, "reached Bob");

        // it should move the votes with them
        assertEq(captable.getVotes(users.amira), 900, "Amira's votes");
        assertEq(captable.getVotes(users.bob), 100, "Bob's votes");
    }

    function test_WhenTheCallerIsTheCompanyGovernorAfterAPassedVote() external {
        _lock(COMMON, users.amira, 300); // 700 unlocked

        // it should emit ForcedTransfer with the reason
        vm.expectEmit(address(captable));
        emit ICaptable.ForcedTransfer(COMMON, users.amira, users.bob, 700, REASON);
        vm.prank(address(governor));
        captable.forcedTransfer(COMMON, users.amira, users.bob, 700, REASON);

        // it should move the unlocked shares without the holder's consent
        // it should move the shares without checking the transfer rule
        assertEq(_token(COMMON).balanceOf(users.amira), 300, "only the locked shares stay");
        assertEq(_token(COMMON).balanceOf(users.bob), 700, "reached Bob past deny all");

        // it should move the votes with them
        assertEq(captable.getVotes(users.amira), 300, "Amira's votes");
        assertEq(captable.getVotes(users.bob), 700, "Bob's votes");
    }
}
