// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Escrow } from "../../../../../src/money/Escrow.sol";
import { EscrowFactory } from "../../../../../src/money/EscrowFactory.sol";
import { IEscrow } from "../../../../../src/interfaces/IEscrow.sol";
import { IEscrowFactory } from "../../../../../src/interfaces/IEscrowFactory.sol";

import { Escrow_Test } from "../../../../utils/Escrow/Escrow_Test.sol";

contract PredictAddress_EscrowFactory_Unit_Concrete_Test is Escrow_Test {
    function test_RevertWhen_TheTermsAreInvalid() external {
        IEscrow.Terms memory terms = _terms(users.bob, INVOICE);
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
        IEscrow.Terms memory terms = _terms(users.bob, INVOICE);
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(type(Escrow).creationCode, abi.encode(terms, address(payments), companiesHouse))
        );
        // it should return the CREATE2 address of the escrow for these terms and salt
        assertEq(factory.predictAddress(terms, SALT), vm.computeCreate2Address(SALT, initCodeHash, address(factory)));
    }

    function test_WhenTheSaltOrAnyTermChanges() external whenTheTermsAreValid {
        IEscrow.Terms memory base = _terms(address(claimedPayee), CLAIM);
        address original = factory.predictAddress(base, SALT);
        IEscrow.Terms memory t;

        // it should return a different address
        assertNotEq(factory.predictAddress(base, bytes32(uint256(SALT) + 1)), original, "salt");
        t = _terms(address(claimedPayee), CLAIM);
        t.ownerSafe = users.ben;
        assertNotEq(factory.predictAddress(t, SALT), original, "ownerSafe");
        t = _terms(address(claimedPayee), CLAIM);
        t.payeeSafe = address(unclaimedPayee);
        assertNotEq(factory.predictAddress(t, SALT), original, "payeeSafe");
        t = _terms(address(claimedPayee), CLAIM);
        t.token = address(dai);
        assertNotEq(factory.predictAddress(t, SALT), original, "token");
        t = _terms(address(claimedPayee), CLAIM);
        t.amount = AMOUNT + 1;
        assertNotEq(factory.predictAddress(t, SALT), original, "amount");
        t = _terms(address(claimedPayee), CLAIM);
        t.jobNonce = bytes32(uint256(2));
        assertNotEq(factory.predictAddress(t, SALT), original, "jobNonce");
        t = _terms(address(claimedPayee), CLAIM);
        t.kind = KIND + 1;
        assertNotEq(factory.predictAddress(t, SALT), original, "kind");
        t = _terms(address(claimedPayee), CLAIM);
        t.documentHash = keccak256("another invoice");
        assertNotEq(factory.predictAddress(t, SALT), original, "documentHash");
        t = _terms(address(claimedPayee), INVOICE);
        assertNotEq(factory.predictAddress(t, SALT), original, "condition");

        // Another configuration gives another address (R2 ES19): the init code binds both.
        EscrowFactory sameAddressOtherPayments = new EscrowFactory(users.eve, companiesHouse);
        EscrowFactory otherBootstrap = new EscrowFactory(address(payments), users.eve);
        bytes32 ownHash = keccak256(
            abi.encodePacked(type(Escrow).creationCode, abi.encode(base, address(payments), companiesHouse))
        );
        assertNotEq(
            sameAddressOtherPayments.predictAddress(base, SALT),
            vm.computeCreate2Address(SALT, ownHash, address(sameAddressOtherPayments)),
            "payments bound"
        );
        assertNotEq(
            otherBootstrap.predictAddress(base, SALT),
            vm.computeCreate2Address(SALT, ownHash, address(otherBootstrap)),
            "bootstrap owner bound"
        );
    }
}
