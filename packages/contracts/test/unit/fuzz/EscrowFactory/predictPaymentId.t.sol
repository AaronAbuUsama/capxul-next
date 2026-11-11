// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IEscrow } from "../../../../src/interfaces/IEscrow.sol";

import { Escrow_Test } from "../../../utils/Escrow/Escrow_Test.sol";

/// @notice Fuzz ranges for trees/EscrowFactory/predictPaymentId.tree.
contract PredictPaymentId_EscrowFactory_Unit_Fuzz_Test is Escrow_Test {
    /// @dev Both leaves for any salt and condition: the id binds the predicted escrow only for a claim.
    function testFuzz_PredictPaymentId(bytes32 salt, bool claim) external view {
        IEscrow.Terms memory terms = _terms(address(claimedPayee), claim ? CLAIM : INVOICE);
        address escrow = factory.predictAddress(terms, salt);
        assertEq(factory.predictPaymentId(terms, salt), _item(terms, escrow).paymentId);
    }
}
