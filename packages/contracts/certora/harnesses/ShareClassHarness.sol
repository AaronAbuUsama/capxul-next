// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ShareClass } from "../../src/equity/ShareClass.sol";

/// @notice ShareClass as the Prover sees it (fv/certora.md: a harness exposes, never changes behaviour). It
/// adds nothing today: every value the ShareClass rules read (`safe`, `captable`, `getVotes`, `delegates`,
/// `balanceOf`, `safeBalanceAt`) is already external. It exists so the conf names one stable contract.
contract ShareClassHarness is ShareClass { }
