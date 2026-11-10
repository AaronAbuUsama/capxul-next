// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IEscrow } from "../../../../src/interfaces/IEscrow.sol";

import { Escrow_Test } from "../../../utils/Escrow/Escrow_Test.sol";
import { PayeeSafeMock } from "../../../utils/Escrow/PayeeSafeMock.sol";
import { RawAnswerPayee } from "../../../utils/Escrow/RawAnswerPayee.sol";

/// @notice Fuzz ranges for trees/Escrow/conditionMet.tree (invariant S8 at the unit level).
contract ConditionMet_Escrow_Unit_Fuzz_Test is Escrow_Test {
    /// @dev Invoice leaves: met iff the balance is at least the amount, for any amount and balance.
    function testFuzz_WhenTheConditionIsInvoiceAmountReached(uint256 amount, uint256 balance) external {
        IEscrow.Terms memory terms = _terms(users.bob, INVOICE);
        terms.amount = bound(amount, 1, 1e36);
        balance = bound(balance, 0, 1e36);
        IEscrow escrow = _escrow(terms);
        usdc.mint(address(escrow), balance);
        assertEq(escrow.conditionMet(), balance >= terms.amount);
    }

    /// @dev Leaves "a word that is neither 0 nor 1" and the honest answers: met iff the word is exactly 0.
    function testFuzz_WhenIsOwnerReturnsAWord(uint256 word) external {
        IEscrow escrow = _claimEscrow(claimedPayee);
        claimedPayee.setAnswer(PayeeSafeMock.Answer.Word, word);
        assertEq(escrow.conditionMet(), word == 0);
    }

    /// @dev Owner-count leaves: met iff Companies House is not among the owners, whatever their number (D11).
    function testFuzz_WhenThePayeeHasAnyNumberOfOwners(uint8 extraOwners, bool listsCompaniesHouse) external {
        extraOwners = uint8(bound(extraOwners, 0, 8));
        PayeeSafeMock payee = _payee(listsCompaniesHouse ? companiesHouse : users.alice);
        for (uint256 i; i < extraOwners; ++i) {
            payee.addOwner(address(uint160(0x1000 + i)));
        }
        assertEq(_claimEscrow(payee).conditionMet(), !listsCompaniesHouse);
    }

    /// @dev D11 fail-closed over any answer: whatever bytes `isOwner` returns (empty, short, long, any word)
    /// or reverts with, the condition is met iff the answer is exactly the 32-byte word 0.
    function testFuzz_WhenIsOwnerAnswersAnyBytes(bytes calldata answer, bool reverts) external {
        RawAnswerPayee payee = new RawAnswerPayee();
        payee.set(answer, reverts);
        IEscrow escrow = _escrow(_terms(address(payee), CLAIM));
        bool expected = !reverts && answer.length == 32 && bytes32(answer) == bytes32(0);
        assertEq(escrow.conditionMet(), expected);
    }

    /// @dev D11 fail-closed on a revert whose data looks like an answer: a revert carrying exactly one word,
    /// the word 0 included, still reads as not claimed (the call's success flag is checked, not only the data).
    function testFuzz_WhenIsOwnerRevertsWithOneWord(uint256 word) external {
        RawAnswerPayee payee = new RawAnswerPayee();
        IEscrow escrow = _escrow(_terms(address(payee), CLAIM));
        payee.set(abi.encode(word), true);
        assertFalse(escrow.conditionMet(), "any one-word revert");
        payee.set(abi.encode(uint256(0)), true);
        assertFalse(escrow.conditionMet(), "revert with the word 0");
        payee.set(abi.encode(uint256(0)), false);
        assertTrue(escrow.conditionMet(), "the same word returned is a claim");
    }

    /// @dev D11 fail-closed on a payee that is not a Safe: an EOA, a contract without `isOwner` (it reverts),
    /// and a contract whose silent fallback returns nothing all read as not claimed.
    function testFuzz_WhenThePayeeIsNotASafe(address eoa) external {
        vm.assume(eoa.code.length == 0 && eoa != address(0));
        assertFalse(_escrow(_terms(eoa, CLAIM)).conditionMet(), "EOA");
        assertFalse(_escrow(_terms(address(usdc), CLAIM)).conditionMet(), "contract without isOwner");
        RawAnswerPayee silent = new RawAnswerPayee();
        assertFalse(_escrow(_terms(address(silent), CLAIM)).conditionMet(), "empty answer");
    }
}
