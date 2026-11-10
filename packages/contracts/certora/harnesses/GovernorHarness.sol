// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Governor } from "../../src/equity/Governor.sol";

/// @notice The Governor as the Prover sees it (fv/certora.md: a harness exposes, never changes behaviour). It
/// adds one read: a proposal's state as a number, because the OpenZeppelin `IGovernor` and Capxul's
/// `IGovernor` share a name and CVL cannot tell their `ProposalState` apart.
contract GovernorHarness is Governor {
    /// @notice `state(proposalId)` as its enum index (4 = Succeeded, 5 = Queued).
    function stateIndex(uint256 proposalId) external view returns (uint8) {
        return uint8(this.state(proposalId));
    }
}
