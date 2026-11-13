// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IEscrow } from "../../../../../src/interfaces/IEscrow.sol";

import { Escrow_Test } from "../../../../utils/Escrow/Escrow_Test.sol";
import { AuthorityMock } from "../../../../utils/Escrow/AuthorityMock.sol";

/// @notice Who may refund (G6, G9): the sender always; anyone else only when the authority term answers exactly true
/// for the escrow's key at the call. The rest of `refund` is in refund.t.sol.
contract RefundAuthority_Escrow_Unit_Concrete_Test is Escrow_Test {
    modifier whenTheCallerIsNeitherTheSenderNorAdmittedByTheAuthority() {
        _;
    }

    function test_WhenTheCallerIsNeitherTheSenderNorAdmittedByTheAuthority()
        external
        whenTheCallerIsNeitherTheSenderNorAdmittedByTheAuthority
    {
        IEscrow escrow = _escrow(_departmentTerms(address(claimedOwner)));
        usdc.mint(address(escrow), AMOUNT);
        // it should revert with CannotRefund, for the owner and any other caller
        address[3] memory callers = [users.eve, address(claimedOwner), address(authority)];
        for (uint256 i; i < callers.length; ++i) {
            assertFalse(escrow.canRefund(callers[i]), "canRefund agrees");
            vm.prank(callers[i]);
            vm.expectRevert(abi.encodeWithSelector(IEscrow.CannotRefund.selector, callers[i]));
            escrow.refund();
        }
        assertEq(_state(escrow), uint256(IEscrow.State.Open), "still open");
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT, "still funded");
    }

    function test_GivenTheEscrowHasNoAuthority() external whenTheCallerIsNeitherTheSenderNorAdmittedByTheAuthority {
        IEscrow.Terms memory terms = _terms(address(claimedOwner), OWNER_COLLECTS);
        terms.authorityKey = BUDGET_ID; // a key with no authority means nothing
        IEscrow escrow = _escrow(terms);
        usdc.mint(address(escrow), AMOUNT);
        authority.admit(BUDGET_ID, users.jordan); // admitted somewhere else, irrelevant here
        // it should refuse every caller but the sender
        assertFalse(escrow.canRefund(users.jordan), "no authority to admit");
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IEscrow.CannotRefund.selector, users.jordan));
        escrow.refund();
        assertTrue(escrow.canRefund(sender), "the sender always may");
    }

    function test_WhenTheCallerIsAdmittedByTheAuthorityForTheEscrowsKey() external {
        IEscrow escrow = _escrow(_departmentTerms(address(claimedOwner)));
        usdc.mint(address(escrow), AMOUNT + 3);
        authority.admit(BUDGET_ID, users.jordan);
        uint256 senderBefore = usdc.balanceOf(sender);
        uint256 callerBefore = usdc.balanceOf(users.jordan);
        assertTrue(escrow.canRefund(users.jordan), "canRefund admits the wearer");

        // it should emit EscrowRefunded naming the caller as by
        vm.expectEmit(true, true, true, true, address(escrow));
        emit IEscrow.EscrowRefunded(sender, users.jordan, escrow.paymentId(), AMOUNT + 3, IEscrow.State.Refunded);
        vm.prank(users.jordan);
        escrow.refund();

        // it should pay the whole balance to the sender, not to the caller
        assertEq(usdc.balanceOf(sender) - senderBefore, AMOUNT + 3, "money back to the sender");
        assertEq(usdc.balanceOf(users.jordan), callerBefore, "the caller got nothing");
        assertEq(_state(escrow), uint256(IEscrow.State.Refunded), "refunded");
    }

    function test_WhenTheAuthorityAdmitsTheCallerOnlyForAnotherKey() external {
        IEscrow escrow = _escrow(_departmentTerms(address(claimedOwner)));
        usdc.mint(address(escrow), AMOUNT);
        authority.admit(BUDGET_ID + 1, users.jordan);
        // it should revert with CannotRefund
        assertFalse(escrow.canRefund(users.jordan), "another budget's wearer");
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IEscrow.CannotRefund.selector, users.jordan));
        escrow.refund();
    }

    function test_WhenTheAuthorityRevertsOrAnswersMalformed() external {
        IEscrow escrow = _escrow(_departmentTerms(address(claimedOwner)));
        usdc.mint(address(escrow), AMOUNT);
        authority.admit(BUDGET_ID, users.jordan);
        assertTrue(escrow.canRefund(users.jordan), "control: the honest answer admits");

        // it should refuse the caller (revert, 31 bytes, 64 bytes, a word of 2)
        AuthorityMock.Answer[4] memory answers =
            [AuthorityMock.Answer.Revert, AuthorityMock.Answer.Short, AuthorityMock.Answer.Long, AuthorityMock.Answer.Word];
        for (uint256 i; i < answers.length; ++i) {
            authority.setAnswer(answers[i], 2);
            assertFalse(escrow.canRefund(users.jordan), "canRefund fails closed");
            vm.prank(users.jordan);
            vm.expectRevert(abi.encodeWithSelector(IEscrow.CannotRefund.selector, users.jordan));
            escrow.refund();
        }
        authority.setAnswer(AuthorityMock.Answer.Word, type(uint256).max);
        assertFalse(escrow.canRefund(users.jordan), "an all-ones word is not true");
        authority.setAnswer(AuthorityMock.Answer.Word, 1);
        assertTrue(escrow.canRefund(users.jordan), "control: exactly one admits");

        // it should still let the sender refund
        authority.setAnswer(AuthorityMock.Answer.Revert, 0);
        assertTrue(escrow.canRefund(sender), "the sender needs no authority");
        vm.prank(sender);
        escrow.refund();
        assertEq(_state(escrow), uint256(IEscrow.State.Refunded), "refunded by the sender");
    }

    function test_WhenTheAuthorityHasNoCode() external {
        IEscrow.Terms memory terms = _departmentTerms(address(claimedOwner));
        terms.authority = makeAddr("authority with no code");
        IEscrow escrow = _escrow(terms);
        usdc.mint(address(escrow), AMOUNT);
        // it should refuse every caller but the sender
        assertFalse(escrow.canRefund(users.jordan), "no code admits nobody");
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IEscrow.CannotRefund.selector, users.jordan));
        escrow.refund();
        assertTrue(escrow.canRefund(sender), "sender");
    }

    function test_GivenTheHolderIsTakenOutAndTheNextWearerAdmitted() external {
        IEscrow escrow = _escrow(_departmentTerms(address(claimedOwner)));
        usdc.mint(address(escrow), AMOUNT);
        authority.admit(BUDGET_ID, users.jordan);
        assertTrue(escrow.canRefund(users.jordan), "jordan wears the hat");

        // The hat moves from Jordan to Ben; nothing about the escrow is written.
        authority.remove(BUDGET_ID, users.jordan);
        authority.admit(BUDGET_ID, users.ben);

        // it should refuse the old holder at once
        assertFalse(escrow.canRefund(users.jordan), "jordan refused");
        vm.prank(users.jordan);
        vm.expectRevert(abi.encodeWithSelector(IEscrow.CannotRefund.selector, users.jordan));
        escrow.refund();
        // it should admit the new holder with no other write
        uint256 senderBefore = usdc.balanceOf(sender);
        vm.prank(users.ben);
        escrow.refund();
        assertEq(usdc.balanceOf(sender) - senderBefore, AMOUNT, "back to the sender");
    }
}
