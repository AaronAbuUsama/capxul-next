// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { AgentOwner_Test } from "../../../../utils/AgentOwner/AgentOwner_Test.sol";

contract SupportsInterface_AgentOwner_Unit_Concrete_Test is AgentOwner_Test {
    function test_WhenAskedForSafesTransactionGuardInterface() external view {
        // it should return true
        assertTrue(agentOwner.supportsInterface(0xe6d7a83a));
    }

    function test_WhenAskedForSafesModuleGuardInterface() external view {
        // it should return true
        assertTrue(agentOwner.supportsInterface(0x58401ed8));
    }

    function test_WhenAskedForERC_165() external view {
        // it should return true
        assertTrue(agentOwner.supportsInterface(0x01ffc9a7));
    }

    function test_WhenAskedForAnotherInterface() external view {
        // it should return false
        assertFalse(agentOwner.supportsInterface(0xffffffff));
    }
}
