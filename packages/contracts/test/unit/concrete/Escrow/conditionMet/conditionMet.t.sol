// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IEscrow } from "../../../../../src/interfaces/IEscrow.sol";

import { Escrow_Test } from "../../../../utils/Escrow/Escrow_Test.sol";
import { OwnerSafeMock } from "../../../../utils/Escrow/OwnerSafeMock.sol";

contract ConditionMet_Escrow_Unit_Concrete_Test is Escrow_Test {
    modifier whenTheConditionIsAmountReached() {
        _;
    }

    function test_WhenTheEscrowHoldsAtLeastTheAmount() external whenTheConditionIsAmountReached {
        IEscrow escrow = _invoiceEscrow();
        usdc.mint(address(escrow), AMOUNT);
        // it should return true
        assertTrue(escrow.conditionMet(), "exactly the amount");
        usdc.mint(address(escrow), 1);
        assertTrue(escrow.conditionMet(), "more than the amount");
    }

    function test_WhenItHoldsLess() external whenTheConditionIsAmountReached {
        IEscrow escrow = _invoiceEscrow();
        usdc.mint(address(escrow), AMOUNT - 1);
        // it should return false
        assertFalse(escrow.conditionMet());
    }

    modifier whenTheConditionIsOwnerCollects() {
        _;
    }

    function test_WhenTheBootstrapOwnerTermIsZero() external whenTheConditionIsOwnerCollects {
        IEscrow.Terms memory terms = _terms(users.bob, OWNER_COLLECTS);
        terms.bootstrapOwner = address(0);
        // it should return true, even for an owner with no code
        assertTrue(_escrow(terms).conditionMet(), "a plain account can act");
        terms.owner = address(unclaimedOwner);
        assertTrue(_escrow(terms).conditionMet(), "no bootstrap owner to wait for");
    }

    function test_WhenTheOwnerHasNoCode() external whenTheConditionIsOwnerCollects {
        IEscrow escrow = _escrow(_terms(users.bob, OWNER_COLLECTS));
        usdc.mint(address(escrow), AMOUNT);
        // it should return false
        assertFalse(escrow.conditionMet());
    }

    function test_WhenIsOwnerOfTheBootstrapOwnerReverts() external whenTheConditionIsOwnerCollects {
        claimedOwner.setAnswer(OwnerSafeMock.Answer.Revert, 0);
        // it should return false
        assertFalse(_claimEscrow(claimedOwner).conditionMet());
    }

    function test_WhenIsOwnerReturnsFewerOrMoreThan32Bytes() external whenTheConditionIsOwnerCollects {
        IEscrow escrow = _claimEscrow(claimedOwner);
        // it should return false
        claimedOwner.setAnswer(OwnerSafeMock.Answer.Short, 0);
        assertFalse(escrow.conditionMet(), "31 bytes");
        claimedOwner.setAnswer(OwnerSafeMock.Answer.Long, 0);
        assertFalse(escrow.conditionMet(), "64 bytes");
    }

    function test_WhenIsOwnerReturnsAWordThatIsNeither0Nor1() external whenTheConditionIsOwnerCollects {
        IEscrow escrow = _claimEscrow(claimedOwner);
        // it should return false
        claimedOwner.setAnswer(OwnerSafeMock.Answer.Word, 2);
        assertFalse(escrow.conditionMet(), "word 2");
        claimedOwner.setAnswer(OwnerSafeMock.Answer.Word, type(uint256).max);
        assertFalse(escrow.conditionMet(), "word max");
        claimedOwner.setAnswer(OwnerSafeMock.Answer.Word, 0);
        assertTrue(escrow.conditionMet(), "control: an exact false word is met");
    }

    function test_WhenTheBootstrapOwnerIsTheOwnersOnlyOwner() external whenTheConditionIsOwnerCollects {
        // it should return false
        assertFalse(_claimEscrow(unclaimedOwner).conditionMet());
    }

    function test_WhenTheBootstrapOwnerIsOneOfSeveralOwners() external whenTheConditionIsOwnerCollects {
        unclaimedOwner.addOwner(users.alice);
        unclaimedOwner.addOwner(users.bob);
        // it should return false
        assertFalse(_claimEscrow(unclaimedOwner).conditionMet());
    }

    function test_WhenTheOwnerHasOneOwnerWhoIsNotTheBootstrapOwner() external whenTheConditionIsOwnerCollects {
        IEscrow escrow = _claimEscrow(claimedOwner);
        // it should return true, whatever the escrow holds
        assertTrue(escrow.conditionMet());
    }

    function test_WhenTheOwnerHasTwoOwnersAndNeitherIsTheBootstrapOwner() external whenTheConditionIsOwnerCollects {
        claimedOwner.addOwner(users.bob);
        // it should return true
        assertTrue(_claimEscrow(claimedOwner).conditionMet());
    }

    function test_WhenTheBootstrapOwnerTermNamesSomeoneOtherThanTheFactorysCompaniesHouse()
        external
        whenTheConditionIsOwnerCollects
    {
        // Alice's Safe lists Alice. With Alice as the term, Alice's Safe cannot act; Companies House is irrelevant.
        IEscrow.Terms memory terms = _terms(address(claimedOwner), OWNER_COLLECTS);
        terms.bootstrapOwner = users.alice;
        // it should check only its own term
        assertFalse(_escrow(terms).conditionMet(), "its own term still listed");
        terms.owner = address(unclaimedOwner); // lists Companies House, not Alice
        assertTrue(_escrow(terms).conditionMet(), "the factory's Companies House is not consulted");
    }
}
