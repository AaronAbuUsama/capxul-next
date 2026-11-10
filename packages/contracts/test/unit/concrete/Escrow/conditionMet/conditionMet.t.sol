// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IEscrow } from "../../../../../src/interfaces/IEscrow.sol";

import { Escrow_Test } from "../../../../utils/Escrow/Escrow_Test.sol";
import { PayeeSafeMock } from "../../../../utils/Escrow/PayeeSafeMock.sol";

contract ConditionMet_Escrow_Unit_Concrete_Test is Escrow_Test {
    modifier whenTheConditionIsInvoiceAmountReached() {
        _;
    }

    function test_WhenTheEscrowHoldsAtLeastTheAmount() external whenTheConditionIsInvoiceAmountReached {
        IEscrow escrow = _invoiceEscrow();
        usdc.mint(address(escrow), AMOUNT);
        // it should return true
        assertTrue(escrow.conditionMet(), "exactly the amount");
        usdc.mint(address(escrow), 1);
        assertTrue(escrow.conditionMet(), "more than the amount");
    }

    function test_WhenItHoldsLess() external whenTheConditionIsInvoiceAmountReached {
        IEscrow escrow = _invoiceEscrow();
        usdc.mint(address(escrow), AMOUNT - 1);
        // it should return false
        assertFalse(escrow.conditionMet());
    }

    modifier whenTheConditionIsPayeeClaimed() {
        _;
    }

    function test_WhenThePayeeHasNoCode() external whenTheConditionIsPayeeClaimed {
        IEscrow escrow = _escrow(_terms(users.bob, CLAIM));
        usdc.mint(address(escrow), AMOUNT);
        // it should return false
        assertFalse(escrow.conditionMet());
    }

    function test_WhenIsOwnerOfCompaniesHouseReverts() external whenTheConditionIsPayeeClaimed {
        claimedPayee.setAnswer(PayeeSafeMock.Answer.Revert, 0);
        // it should return false
        assertFalse(_claimEscrow(claimedPayee).conditionMet());
    }

    function test_WhenIsOwnerReturnsFewerOrMoreThan32Bytes() external whenTheConditionIsPayeeClaimed {
        IEscrow escrow = _claimEscrow(claimedPayee);
        // it should return false
        claimedPayee.setAnswer(PayeeSafeMock.Answer.Short, 0);
        assertFalse(escrow.conditionMet(), "31 bytes");
        claimedPayee.setAnswer(PayeeSafeMock.Answer.Long, 0);
        assertFalse(escrow.conditionMet(), "64 bytes");
    }

    function test_WhenIsOwnerReturnsAWordThatIsNeither0Nor1() external whenTheConditionIsPayeeClaimed {
        IEscrow escrow = _claimEscrow(claimedPayee);
        // it should return false
        claimedPayee.setAnswer(PayeeSafeMock.Answer.Word, 2);
        assertFalse(escrow.conditionMet(), "word 2");
        claimedPayee.setAnswer(PayeeSafeMock.Answer.Word, type(uint256).max);
        assertFalse(escrow.conditionMet(), "word max");
    }

    function test_WhenCompaniesHouseIsThePayeesOnlyOwner() external whenTheConditionIsPayeeClaimed {
        // it should return false
        assertFalse(_claimEscrow(unclaimedPayee).conditionMet());
    }

    function test_WhenCompaniesHouseIsOneOfSeveralOwners() external whenTheConditionIsPayeeClaimed {
        unclaimedPayee.addOwner(users.alice);
        unclaimedPayee.addOwner(users.bob);
        // it should return false
        assertFalse(_claimEscrow(unclaimedPayee).conditionMet());
    }

    function test_WhenThePayeeHasOneOwnerWhoIsNotCompaniesHouse() external whenTheConditionIsPayeeClaimed {
        IEscrow escrow = _claimEscrow(claimedPayee);
        // it should return true, whatever the escrow holds
        assertTrue(escrow.conditionMet());
    }

    function test_WhenThePayeeHasTwoOwnersAndNeitherIsCompaniesHouse() external whenTheConditionIsPayeeClaimed {
        claimedPayee.addOwner(users.bob);
        // it should return true
        assertTrue(_claimEscrow(claimedPayee).conditionMet());
    }
}
