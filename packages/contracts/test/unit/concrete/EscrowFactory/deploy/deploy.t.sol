// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Vm } from "forge-std/Vm.sol";

import { IEscrow } from "../../../../../src/interfaces/IEscrow.sol";
import { IEscrowFactory } from "../../../../../src/interfaces/IEscrowFactory.sol";
import { EscrowFactory } from "../../../../../src/money/EscrowFactory.sol";

import { Escrow_Test } from "../../../../utils/Escrow/Escrow_Test.sol";

contract Deploy_EscrowFactory_Unit_Concrete_Test is Escrow_Test {
    function test_WhenAFactoryDependencyIsZero() external {
        // it should reject an unusable factory
        vm.expectRevert(IEscrowFactory.ZeroAddress.selector);
        new EscrowFactory(address(0), companiesHouse);
        vm.expectRevert(IEscrowFactory.ZeroAddress.selector);
        new EscrowFactory(address(payments), address(0));
    }

    function test_WhenTheTermsAreInvalid() external {
        // it should revert with the same error the escrow would
        assertEq(IEscrowFactory.ZeroAddress.selector, IEscrow.ZeroAddress.selector, "same selectors");
        IEscrow.Terms memory terms = _terms(users.bob, INVOICE);
        terms.payeeSafe = address(0);
        vm.expectRevert(IEscrowFactory.ZeroAddress.selector);
        factory.deploy(terms, SALT);

        terms = _terms(users.bob, INVOICE);
        terms.amount = 0;
        vm.expectRevert(IEscrowFactory.ZeroAmount.selector);
        factory.deploy(terms, SALT);

        terms = _terms(users.bob, INVOICE);
        terms.jobNonce = bytes32(0);
        vm.expectRevert(IEscrowFactory.ZeroJobNonce.selector);
        factory.deploy(terms, SALT);

        terms = _terms(users.bob, INVOICE);
        terms.documentHash = bytes32(0);
        vm.expectRevert(IEscrowFactory.ZeroDocumentHash.selector);
        factory.deploy(terms, SALT);

        terms = _terms(users.bob, 2);
        vm.expectRevert(abi.encodeWithSelector(IEscrowFactory.InvalidCondition.selector, uint8(2)));
        factory.deploy(terms, SALT);
    }

    function test_WhenAnEscrowAlreadyExistsAtThePredictedAddress() external {
        IEscrow.Terms memory terms = _terms(users.bob, INVOICE);
        address first = factory.deploy(terms, SALT);
        usdc.mint(first, AMOUNT);
        bytes32 codehash = first.codehash;

        vm.recordLogs();
        // it should return that address and deploy nothing
        address second = factory.deploy(terms, SALT);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(second, first, "same escrow");
        assertEq(logs.length, 0, "no deploy, no event");
        assertEq(second.codehash, codehash, "same code");
        assertEq(IEscrow(second).ownerSafe(), owner, "owner kept");
        assertEq(usdc.balanceOf(second), AMOUNT, "funds kept");
    }

    function test_WhenNoEscrowExistsThere() external {
        IEscrow.Terms memory terms = _terms(address(claimedPayee), CLAIM);
        address predicted = factory.predictAddress(terms, SALT);
        bytes32 id = factory.predictPaymentId(terms, SALT);
        usdc.mint(predicted, AMOUNT); // the payer funds it before it exists
        assertEq(predicted.code.length, 0, "nothing there yet");

        // it should emit EscrowDeployed with the payment id and the salt
        vm.expectEmit(true, true, true, true, address(factory));
        emit IEscrowFactory.EscrowDeployed(predicted, owner, address(claimedPayee), id, SALT);
        address escrow = factory.deploy(terms, SALT);

        // it should deploy the escrow at the predicted address with CREATE2
        assertEq(escrow, predicted, "predicted address");
        assertGt(escrow.code.length, 0, "deployed");
        assertEq(IEscrow(escrow).paymentId(), id, "payment id");
        assertEq(IEscrow(escrow).payeeSafe(), address(claimedPayee), "terms");
        assertEq(address(IEscrow(escrow).payments()), address(payments), "payments bound");
        assertEq(IEscrow(escrow).bootstrapOwner(), companiesHouse, "bootstrap owner bound");
        assertEq(usdc.balanceOf(escrow), AMOUNT, "early funds kept");
    }
}
