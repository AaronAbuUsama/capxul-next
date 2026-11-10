// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IEscrow } from "../../../../src/interfaces/IEscrow.sol";

import { Escrow_Test } from "../../../utils/Escrow/Escrow_Test.sol";

/// @notice Fuzz ranges for trees/EscrowFactory/deploy.tree (S3, S6 at the unit level).
contract Deploy_EscrowFactory_Unit_Fuzz_Test is Escrow_Test {
    /// @dev Leaves "no escrow exists there" and "already exists": any valid terms and salt.
    function testFuzz_WhenNoEscrowExistsThere(
        address ownerSafe,
        address payeeSafe,
        uint256 amount,
        bytes32 jobNonce,
        uint16 kind,
        bytes32 doc,
        bool claim,
        bytes32 salt
    )
        external
    {
        vm.assume(ownerSafe != address(0) && payeeSafe != address(0));
        vm.assume(jobNonce != bytes32(0) && doc != bytes32(0));
        IEscrow.Terms memory terms = IEscrow.Terms({
            ownerSafe: ownerSafe,
            payeeSafe: payeeSafe,
            token: address(usdc),
            amount: bound(amount, 1, type(uint256).max),
            jobNonce: jobNonce,
            kind: kind,
            documentHash: doc,
            condition: claim ? CLAIM : INVOICE
        });
        address predicted = factory.predictAddress(terms, salt);
        bytes32 predictedId = factory.predictPaymentId(terms, salt);

        address escrow = factory.deploy(terms, salt);

        assertEq(escrow, predicted, "S3 predicted address");
        assertEq(IEscrow(escrow).paymentId(), predictedId, "S6 predicted id");
        assertEq(factory.deploy(terms, salt), escrow, "S3 second deploy");
    }
}
