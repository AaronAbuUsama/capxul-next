// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Exits } from "../../src/equity/Exits.sol";
// The spec summarises calls whose arguments are these structs; importing them puts the types in scope.
import { IEscrow } from "../../src/interfaces/IEscrow.sol"; // forge-lint: disable-line(unused-import)
import { IPayments } from "../../src/interfaces/IPayments.sol"; // forge-lint: disable-line(unused-import)

/// @notice Exits as the Prover sees it (fv/certora.md: a harness exposes, never changes behaviour). IExits has
/// no getter for the company Safe, so the harness reads the wiring `initialize` stores.
contract ExitsHarness is Exits {
    /// @notice The company Safe (the Board) this clone was initialised with.
    function boardSafe() external view returns (address) {
        return _safe;
    }
}
