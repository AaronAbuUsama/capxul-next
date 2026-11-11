// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Options } from "../../src/equity/Options.sol";

/// @notice Options as the Prover sees it (fv/certora.md: a harness exposes, never changes behaviour). It adds
/// one read, `live(id)`: a grant's options still counted in `allocated` (invariant O2), computed from the
/// contract's own external views, so the O2 rules can compare `allocated` with the grants.
contract OptionsHarness is Options {
    /// @notice The options of grant `id` that O2 counts: none once cancelled (lapsed or ended for an exit);
    /// otherwise the vested part at `endedAt` if ended, else every option, less what was exercised.
    function live(uint256 id) external view returns (uint256) {
        OptionGrant memory g = this.getGrant(id);
        if (g.cancelled) return 0;
        uint256 cap = g.endedAt != 0 ? this.vestedOf(id, g.endedAt) : g.shares;
        return cap - g.exercised;
    }
}
