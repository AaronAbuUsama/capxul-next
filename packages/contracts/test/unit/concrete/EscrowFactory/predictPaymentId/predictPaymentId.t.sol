// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IEscrow } from "../../../../../src/interfaces/IEscrow.sol";

import { Escrow_Test } from "../../../../utils/Escrow/Escrow_Test.sol";

contract PredictPaymentId_EscrowFactory_Unit_Concrete_Test is Escrow_Test {
    function test_ShouldEqualThePaymentIdTheDeployedEscrowReports() external {
        IEscrow.Terms memory terms = _terms(users.bob, INVOICE);
        bytes32 predicted = factory.predictPaymentId(terms, SALT);
        address escrow = factory.deploy(terms, SALT);
        // it should equal the payment id the deployed escrow reports
        assertEq(predicted, IEscrow(escrow).paymentId(), "invoice id");
        assertEq(predicted, _item(terms, address(0)).paymentId, "executor empty");
        // Two invoice escrows with the same terms share the id (R2 ES11).
        assertEq(factory.predictPaymentId(terms, keccak256("other salt")), predicted, "salt-free invoice id");
    }

    function test_GivenTheConditionIsPayeeClaimed() external {
        IEscrow.Terms memory terms = _terms(address(claimedPayee), CLAIM);
        address predictedEscrow = factory.predictAddress(terms, SALT);
        bytes32 predicted = factory.predictPaymentId(terms, SALT);
        // it should bind the predicted escrow address as the executor
        assertEq(predicted, _item(terms, predictedEscrow).paymentId, "executor is the predicted escrow");
        assertNotEq(predicted, factory.predictPaymentId(terms, keccak256("other salt")), "a claim id is per escrow");
        assertEq(predicted, IEscrow(factory.deploy(terms, SALT)).paymentId(), "deployed escrow agrees");
    }
}
