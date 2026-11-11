// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Escrow } from "../../src/money/Escrow.sol";

/// @notice Escrow as Certora verifies it (fv/certora.md, "Escrow.spec"). Adds nothing: Escrow's state is
/// already public. The constructor passes through so the immutables can be linked.
contract EscrowHarness is Escrow {
    constructor(
        Terms memory terms,
        address payments_,
        address bootstrapOwner_
    )
        Escrow(terms, payments_, bootstrapOwner_)
    { }
}
