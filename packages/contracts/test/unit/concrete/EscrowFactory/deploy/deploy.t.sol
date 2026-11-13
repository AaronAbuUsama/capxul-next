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
        IEscrow.Terms memory terms = _terms(users.bob, AMOUNT_REACHED);
        terms.owner = address(0);
        vm.expectRevert(IEscrowFactory.ZeroAddress.selector);
        factory.deploy(terms, SALT);

        terms = _terms(users.bob, AMOUNT_REACHED);
        terms.sender = address(0);
        vm.expectRevert(IEscrowFactory.ZeroAddress.selector);
        factory.deploy(terms, SALT);

        terms = _terms(users.bob, AMOUNT_REACHED);
        terms.token = address(0);
        vm.expectRevert(IEscrowFactory.ZeroAddress.selector);
        factory.deploy(terms, SALT);

        terms = _terms(users.bob, AMOUNT_REACHED);
        terms.amount = 0;
        vm.expectRevert(IEscrowFactory.ZeroAmount.selector);
        factory.deploy(terms, SALT);

        terms = _terms(users.bob, AMOUNT_REACHED);
        terms.jobNonce = bytes32(0);
        vm.expectRevert(IEscrowFactory.ZeroJobNonce.selector);
        factory.deploy(terms, SALT);

        terms = _terms(users.bob, AMOUNT_REACHED);
        terms.documentHash = bytes32(0);
        vm.expectRevert(IEscrowFactory.ZeroDocumentHash.selector);
        factory.deploy(terms, SALT);

        terms = _terms(users.bob, 2);
        vm.expectRevert(abi.encodeWithSelector(IEscrowFactory.InvalidCondition.selector, uint8(2)));
        factory.deploy(terms, SALT);
    }

    function test_WhenAnEscrowAlreadyExistsAtThePredictedAddress() external {
        IEscrow.Terms memory terms = _terms(users.bob, AMOUNT_REACHED);
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
        assertEq(IEscrow(second).sender(), sender, "sender kept");
        assertEq(usdc.balanceOf(second), AMOUNT, "funds kept");
    }

    function test_WhenNoEscrowExistsThere() external {
        IEscrow.Terms memory terms = _departmentTerms(address(claimedOwner));
        terms.bootstrapOwner = users.amira; // not the factory's Companies House
        address predicted = factory.predictAddress(terms, SALT);
        bytes32 id = factory.predictPaymentId(terms, SALT);
        usdc.mint(predicted, AMOUNT + 5); // the sender funds it before it exists
        assertEq(predicted.code.length, 0, "nothing there yet");
        uint256 senderBefore = usdc.balanceOf(sender);

        // it should emit EscrowDeployed with the payment id, the salt, the authority and its key
        vm.expectEmit(true, true, true, true, address(factory));
        emit IEscrowFactory.EscrowDeployed(
            predicted, address(claimedOwner), sender, id, SALT, address(authority), BUDGET_ID
        );
        vm.prank(users.eve); // anyone may deploy
        address escrow = factory.deploy(terms, SALT);

        // it should deploy the escrow at the predicted address with CREATE2
        assertEq(escrow, predicted, "predicted address");
        assertGt(escrow.code.length, 0, "deployed");
        assertEq(IEscrow(escrow).paymentId(), id, "payment id");
        assertEq(IEscrow(escrow).owner(), address(claimedOwner), "owner");
        assertEq(IEscrow(escrow).authority(), address(authority), "authority");
        assertEq(IEscrow(escrow).authorityKey(), BUDGET_ID, "authority key");
        assertEq(address(IEscrow(escrow).payments()), address(payments), "payments bound");
        // it should bind the terms' bootstrap owner, not the factory's
        assertEq(IEscrow(escrow).bootstrapOwner(), users.amira, "the term, not the factory's");
        // it should keep money sent to the address before the deploy, and move none
        assertEq(usdc.balanceOf(escrow), AMOUNT + 5, "early funds kept");
        assertEq(usdc.balanceOf(sender), senderBefore, "nothing moved");
        assertEq(uint256(IEscrow(escrow).state()), uint256(IEscrow.State.Open), "open");
    }

    function test_WhenSomeoneElseDeploysFirstWithTheSameTerms() external {
        IEscrow.Terms memory terms = _terms(address(claimedOwner), OWNER_COLLECTS);
        address predicted = factory.predictAddress(terms, SALT);
        vm.prank(users.eve);
        factory.deploy(terms, SALT); // a front-runner
        usdc.mint(predicted, AMOUNT); // the funder's money, after
        // it should give the funder the same escrow
        vm.prank(sender);
        assertEq(factory.deploy(terms, SALT), predicted, "same escrow");
        vm.prank(address(claimedOwner));
        IEscrow(predicted).collect();
        assertEq(usdc.balanceOf(address(claimedOwner)), AMOUNT, "the owner collects as agreed");
    }
}
