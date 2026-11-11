// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { V4Scenario_Test } from "../utils/Scenario/V4Scenario_Test.sol";

/// @notice The startup story (decisions.md M6, with F1 to F3 and F10): Amira and Ben found a company as two
/// Directors (2-of-2), install money with a 600,000 USDC yearly top budget, appoint a CEO and an Ops hat, plan
/// Operating, Operations and Offsite, hire three people on monthly agreements, pay the offsite venue, schedule a
/// supplier payment for the 1st, and install equity (Common, founder shares under Vesting, an option pool).
/// Eve's spend, a self-offer, an early and a second execute, an over-collection and a cut below use are refused.
/// Every checkpoint's numbers are worked out by hand from the specs (scenarios/startup-story.scenario.json).
contract StartupStory_Scenario_Test is V4Scenario_Test {
    function _scenario() internal pure override returns (string memory) {
        return "startup-story";
    }
}
