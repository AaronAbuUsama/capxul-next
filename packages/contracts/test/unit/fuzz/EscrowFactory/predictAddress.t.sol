// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IEscrow } from "../../../../src/interfaces/IEscrow.sol";

import { Escrow_Test } from "../../../utils/Escrow/Escrow_Test.sol";

/// @notice Fuzz ranges for trees/EscrowFactory/predictAddress.tree.
contract PredictAddress_EscrowFactory_Unit_Fuzz_Test is Escrow_Test {
    /// @dev Leaf "when the salt or any term changes": any two salts, any two amounts.
    function testFuzz_WhenTheSaltOrAnyTermChanges(
        bytes32 saltA,
        bytes32 saltB,
        uint256 amountA,
        uint256 amountB
    )
        external
        view
    {
        IEscrow.Terms memory a = _terms(users.bob, INVOICE);
        IEscrow.Terms memory b = _terms(users.bob, INVOICE);
        a.amount = bound(amountA, 1, type(uint256).max);
        b.amount = bound(amountB, 1, type(uint256).max);
        bool same = saltA == saltB && a.amount == b.amount;
        assertEq(factory.predictAddress(a, saltA) == factory.predictAddress(b, saltB), same);
    }
}
