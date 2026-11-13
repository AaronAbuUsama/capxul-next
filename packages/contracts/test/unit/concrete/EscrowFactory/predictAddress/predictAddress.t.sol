// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Escrow } from "../../../../../src/money/Escrow.sol";
import { EscrowFactory } from "../../../../../src/money/EscrowFactory.sol";
import { IEscrow } from "../../../../../src/interfaces/IEscrow.sol";
import { IEscrowFactory } from "../../../../../src/interfaces/IEscrowFactory.sol";

import { Escrow_Test } from "../../../../utils/Escrow/Escrow_Test.sol";

contract PredictAddress_EscrowFactory_Unit_Concrete_Test is Escrow_Test {
    function test_RevertWhen_TheTermsAreInvalid() external {
        IEscrow.Terms memory terms = _terms(users.bob, AMOUNT_REACHED);
        terms.amount = 0;
        // it should revert
        vm.expectRevert(IEscrowFactory.ZeroAmount.selector);
        factory.predictAddress(terms, SALT);
        terms = _terms(users.bob, 5);
        vm.expectRevert(abi.encodeWithSelector(IEscrowFactory.InvalidCondition.selector, uint8(5)));
        factory.predictAddress(terms, SALT);
    }

    modifier whenTheTermsAreValid() {
        _;
    }

    function test_WhenTheTermsAreValid() external view whenTheTermsAreValid {
        IEscrow.Terms memory terms = _departmentTerms(address(claimedOwner));
        bytes32 initCodeHash =
            keccak256(abi.encodePacked(type(Escrow).creationCode, abi.encode(terms, address(payments))));
        // it should return the CREATE2 address of the escrow for these terms and salt
        assertEq(factory.predictAddress(terms, SALT), vm.computeCreate2Address(SALT, initCodeHash, address(factory)));
    }

    function test_WhenTheSaltOrAnyOfTheTwelveTermsChanges() external view whenTheTermsAreValid {
        IEscrow.Terms memory base = _departmentTerms(address(claimedOwner));
        address original = factory.predictAddress(base, SALT);
        IEscrow.Terms memory t;

        // it should return a different address
        assertNotEq(factory.predictAddress(base, bytes32(uint256(SALT) + 1)), original, "salt");
        t = _departmentTerms(address(claimedOwner));
        t.owner = address(unclaimedOwner);
        assertNotEq(factory.predictAddress(t, SALT), original, "owner");
        t = _departmentTerms(address(claimedOwner));
        t.sender = users.ben;
        assertNotEq(factory.predictAddress(t, SALT), original, "sender");
        t = _departmentTerms(address(claimedOwner));
        t.authority = users.eve;
        assertNotEq(factory.predictAddress(t, SALT), original, "authority");
        t = _departmentTerms(address(claimedOwner));
        t.authorityKey = BUDGET_ID + 1;
        assertNotEq(factory.predictAddress(t, SALT), original, "authorityKey");
        t = _departmentTerms(address(claimedOwner));
        t.bootstrapOwner = address(0);
        assertNotEq(factory.predictAddress(t, SALT), original, "bootstrapOwner");
        t = _departmentTerms(address(claimedOwner));
        t.token = address(dai);
        assertNotEq(factory.predictAddress(t, SALT), original, "token");
        t = _departmentTerms(address(claimedOwner));
        t.amount = AMOUNT + 1;
        assertNotEq(factory.predictAddress(t, SALT), original, "amount");
        t = _departmentTerms(address(claimedOwner));
        t.jobNonce = bytes32(uint256(2));
        assertNotEq(factory.predictAddress(t, SALT), original, "jobNonce");
        t = _departmentTerms(address(claimedOwner));
        t.kind = KIND + 1;
        assertNotEq(factory.predictAddress(t, SALT), original, "kind");
        t = _departmentTerms(address(claimedOwner));
        t.documentHash = keccak256("another invoice");
        assertNotEq(factory.predictAddress(t, SALT), original, "documentHash");
        t = _departmentTerms(address(claimedOwner));
        t.condition = AMOUNT_REACHED;
        assertNotEq(factory.predictAddress(t, SALT), original, "condition");
        t = _departmentTerms(address(claimedOwner));
        t.ownerTakesSurplus = true;
        assertNotEq(factory.predictAddress(t, SALT), original, "ownerTakesSurplus");
    }

    function test_WhenTheFactorysPaymentsDiffers() external whenTheTermsAreValid {
        IEscrow.Terms memory base = _departmentTerms(address(claimedOwner));
        EscrowFactory otherPayments = new EscrowFactory(users.eve, companiesHouse);
        bytes32 ownHash = keccak256(abi.encodePacked(type(Escrow).creationCode, abi.encode(base, address(payments))));
        // it should return a different address
        assertNotEq(
            otherPayments.predictAddress(base, SALT),
            vm.computeCreate2Address(SALT, ownHash, address(otherPayments)),
            "payments bound"
        );
    }
}
