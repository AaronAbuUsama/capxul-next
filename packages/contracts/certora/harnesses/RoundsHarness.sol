// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Rounds } from "../../src/equity/Rounds.sol";

/// @notice Rounds as the Prover sees it (fv/certora.md: a harness exposes, never changes behaviour). Every value
/// the Rounds rules read (`safe`, `payments`, `pricedRound`, `position`) is already external; it exists so the conf
/// names one stable contract.
contract RoundsHarness is Rounds { }
