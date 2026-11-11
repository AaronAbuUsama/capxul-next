// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Vesting } from "../../src/equity/Vesting.sol";

/// @notice Vesting as the Prover sees it (fv/certora.md: a harness exposes, never changes behaviour). Every
/// value the Vesting rules read (`getGrant`, `grantOf`, `lockedOf`) is already external; it exists so the conf
/// names one stable contract.
contract VestingHarness is Vesting { }
