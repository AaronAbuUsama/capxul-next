// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IEscrow } from "../../../../src/interfaces/IEscrow.sol";

import { Escrow_Test } from "../../../utils/Escrow/Escrow_Test.sol";

/// @notice Fuzz ranges for unit/concrete/EscrowFactory/deploy/deploy.tree (G1, G2 at the unit level).
contract Deploy_EscrowFactory_Unit_Fuzz_Test is Escrow_Test {
    /// @dev Leaves "no escrow exists there" and "already exists": any valid terms, salt and early funding.
    function testFuzz_WhenNoEscrowExistsThere(IEscrow.Terms memory terms, bytes32 salt, uint256 early) external {
        vm.assume(terms.owner != address(0) && terms.sender != address(0));
        vm.assume(terms.jobNonce != bytes32(0) && terms.documentHash != bytes32(0));
        terms.token = address(usdc);
        terms.amount = bound(terms.amount, 1, type(uint256).max);
        terms.condition = uint8(bound(terms.condition, 0, 1));
        early = bound(early, 0, 1e36);
        address predicted = factory.predictAddress(terms, salt);
        bytes32 predictedId = factory.predictPaymentId(terms, salt);
        usdc.mint(predicted, early);

        address escrow = factory.deploy(terms, salt);

        assertEq(escrow, predicted, "G1 predicted address");
        assertEq(IEscrow(escrow).paymentId(), predictedId, "predicted id");
        assertEq(usdc.balanceOf(escrow), early, "G2 early money kept, nothing moved");
        assertEq(factory.deploy(terms, salt), escrow, "G1 second deploy");
        assertEq(IEscrow(escrow).owner(), terms.owner, "owner");
        assertEq(IEscrow(escrow).sender(), terms.sender, "sender");
        assertEq(IEscrow(escrow).authority(), terms.authority, "authority");
        assertEq(IEscrow(escrow).authorityKey(), terms.authorityKey, "authorityKey");
        assertEq(IEscrow(escrow).bootstrapOwner(), terms.bootstrapOwner, "bootstrapOwner");
        assertEq(IEscrow(escrow).ownerTakesSurplus(), terms.ownerTakesSurplus, "ownerTakesSurplus");
    }
}
