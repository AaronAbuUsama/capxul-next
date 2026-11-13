// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IEscrow } from "../../../../src/interfaces/IEscrow.sol";

import { Escrow_Test } from "../../../utils/Escrow/Escrow_Test.sol";

/// @notice Fuzz ranges for unit/concrete/EscrowFactory/predictPaymentId/predictPaymentId.tree.
contract PredictPaymentId_EscrowFactory_Unit_Fuzz_Test is Escrow_Test {
    /// @dev Both leaves for any salt and condition: the id binds the predicted escrow only for owner-collects.
    function testFuzz_PredictPaymentId(bytes32 salt, bool ownerCollects) external view {
        IEscrow.Terms memory terms = _departmentTerms(address(claimedOwner));
        terms.condition = ownerCollects ? OWNER_COLLECTS : AMOUNT_REACHED;
        address escrow = factory.predictAddress(terms, salt);
        assertEq(factory.predictPaymentId(terms, salt), _item(terms, escrow).paymentId);
    }
}
