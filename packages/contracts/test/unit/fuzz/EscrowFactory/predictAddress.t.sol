// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IEscrow } from "../../../../src/interfaces/IEscrow.sol";

import { Escrow_Test } from "../../../utils/Escrow/Escrow_Test.sol";

/// @notice Fuzz ranges for unit/concrete/EscrowFactory/predictAddress/predictAddress.tree (G1).
contract PredictAddress_EscrowFactory_Unit_Fuzz_Test is Escrow_Test {
    /// @dev One side of the comparison: a salt and the terms that vary.
    struct Side {
        bytes32 salt;
        uint256 amount;
        address authority;
        uint256 authorityKey;
        bool ownerTakesSurplus;
    }

    /// @dev Leaf "when the salt or any term changes": two salts, amounts, authorities, keys and surplus routings.
    /// The addresses are equal exactly when every one of them is.
    function testFuzz_WhenTheSaltOrAnyTermChanges(Side memory a, Side memory b) external view {
        a.amount = bound(a.amount, 1, type(uint256).max);
        b.amount = bound(b.amount, 1, type(uint256).max);
        bool same = a.salt == b.salt && a.amount == b.amount && a.authority == b.authority
            && a.authorityKey == b.authorityKey && a.ownerTakesSurplus == b.ownerTakesSurplus;
        assertEq(_predict(a) == _predict(b), same);
    }

    function _predict(Side memory side) internal view returns (address) {
        IEscrow.Terms memory terms = _terms(users.bob, OWNER_COLLECTS);
        terms.amount = side.amount;
        terms.authority = side.authority;
        terms.authorityKey = side.authorityKey;
        terms.ownerTakesSurplus = side.ownerTakesSurplus;
        return factory.predictAddress(terms, side.salt);
    }
}
