// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { V4Scenario_Test } from "../utils/Scenario/V4Scenario_Test.sol";

/// @notice The life of Capxul, Inc. from docs/planning/protocol-v4/scenarios/capxul-vectors.json: incorporation
/// (founder shares under Vesting, a 1,000,000 pool), the first option grants, two post-money SAFEs, the seed round
/// with the pool top-up and the SAFE conversion, Series A and B, the Series C down round with broad-based
/// weighted-average anti-dilution, a secondary sale, and the strong sale. Share counts and prices are exact; the
/// exit payouts are the Capxul exit vectors to within $1 (scenarios/README.md).
contract EquityLife_Scenario_Test is V4Scenario_Test {
    function _scenario() internal pure override returns (string memory) {
        return "equity-life";
    }
}
