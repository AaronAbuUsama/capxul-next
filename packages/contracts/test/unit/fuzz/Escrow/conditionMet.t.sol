// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IEscrow } from "../../../../src/interfaces/IEscrow.sol";

import { Escrow_Test } from "../../../utils/Escrow/Escrow_Test.sol";
import { OwnerSafeMock } from "../../../utils/Escrow/OwnerSafeMock.sol";
import { RawAnswerTarget } from "../../../utils/Escrow/RawAnswerTarget.sol";

/// @notice Fuzz ranges for unit/concrete/Escrow/conditionMet/conditionMet.tree (invariant S8 at the unit level).
contract ConditionMet_Escrow_Unit_Fuzz_Test is Escrow_Test {
    /// @dev Invoice leaves: met iff the balance is at least the amount, for any amount and balance.
    function testFuzz_WhenTheConditionIsAmountReached(uint256 amount, uint256 balance) external {
        IEscrow.Terms memory terms = _terms(users.bob, AMOUNT_REACHED);
        terms.amount = bound(amount, 1, 1e36);
        balance = bound(balance, 0, 1e36);
        IEscrow escrow = _escrow(terms);
        usdc.mint(address(escrow), balance);
        assertEq(escrow.conditionMet(), balance >= terms.amount);
    }

    /// @dev Leaves "a word that is neither 0 nor 1" and the honest answers: met iff the word is exactly 0.
    function testFuzz_WhenIsOwnerReturnsAWord(uint256 word) external {
        IEscrow escrow = _claimEscrow(claimedOwner);
        claimedOwner.setAnswer(OwnerSafeMock.Answer.Word, word);
        assertEq(escrow.conditionMet(), word == 0);
    }

    /// @dev Owner-count leaves: met iff Companies House is not among the owners, whatever their number (D11).
    function testFuzz_WhenTheOwnerHasAnyNumberOfOwners(uint8 extraOwners, bool listsCompaniesHouse) external {
        extraOwners = uint8(bound(extraOwners, 0, 8));
        OwnerSafeMock ownerSafe = _ownerSafe(listsCompaniesHouse ? companiesHouse : users.alice);
        for (uint256 i; i < extraOwners; ++i) {
            ownerSafe.addOwner(address(uint160(0x1000 + i)));
        }
        assertEq(_claimEscrow(ownerSafe).conditionMet(), !listsCompaniesHouse);
    }

    /// @dev D11 fail-closed over any answer: whatever bytes `isOwner` returns (empty, short, long, any word)
    /// or reverts with, the condition is met iff the answer is exactly the 32-byte word 0.
    function testFuzz_WhenIsOwnerAnswersAnyBytes(bytes calldata answer, bool reverts) external {
        RawAnswerTarget target = new RawAnswerTarget();
        target.set(answer, reverts);
        IEscrow escrow = _escrow(_terms(address(target), OWNER_COLLECTS));
        bool expected = !reverts && answer.length == 32 && bytes32(answer) == bytes32(0);
        assertEq(escrow.conditionMet(), expected);
    }

    /// @dev D11 fail-closed on a revert whose data looks like an answer: a revert carrying exactly one word,
    /// the word 0 included, still reads as not claimed (the call's success flag is checked, not only the data).
    function testFuzz_WhenIsOwnerRevertsWithOneWord(uint256 word) external {
        RawAnswerTarget target = new RawAnswerTarget();
        IEscrow escrow = _escrow(_terms(address(target), OWNER_COLLECTS));
        target.set(abi.encode(word), true);
        assertFalse(escrow.conditionMet(), "any one-word revert");
        target.set(abi.encode(uint256(0)), true);
        assertFalse(escrow.conditionMet(), "revert with the word 0");
        target.set(abi.encode(uint256(0)), false);
        assertTrue(escrow.conditionMet(), "the same word returned is a claim");
    }

    /// @dev A zero bootstrap owner term: met for any owner, whatever it is or answers.
    function testFuzz_WhenTheBootstrapOwnerTermIsZero(address owner_, bytes calldata answer, bool reverts) external {
        vm.assume(owner_ != address(0));
        IEscrow.Terms memory terms = _terms(owner_, OWNER_COLLECTS);
        terms.bootstrapOwner = address(0);
        assertTrue(_escrow(terms).conditionMet(), "any owner");
        RawAnswerTarget target = new RawAnswerTarget();
        target.set(answer, reverts);
        terms.owner = address(target);
        assertTrue(_escrow(terms).conditionMet(), "never asked");
    }

    /// @dev D11 fail-closed on an owner that is not a Safe: an EOA, a contract without `isOwner` (it reverts),
    /// and a contract whose silent fallback returns nothing all read as not claimed.
    function testFuzz_WhenTheOwnerIsNotASafe(address eoa) external {
        vm.assume(eoa.code.length == 0 && eoa != address(0));
        assertFalse(_escrow(_terms(eoa, OWNER_COLLECTS)).conditionMet(), "EOA");
        assertFalse(_escrow(_terms(address(usdc), OWNER_COLLECTS)).conditionMet(), "contract without isOwner");
        RawAnswerTarget silent = new RawAnswerTarget();
        assertFalse(_escrow(_terms(address(silent), OWNER_COLLECTS)).conditionMet(), "empty answer");
    }
}
