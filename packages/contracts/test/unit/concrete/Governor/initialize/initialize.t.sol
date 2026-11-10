// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC5805 } from "@openzeppelin/contracts/interfaces/IERC5805.sol";
import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";

import { Governor } from "../../../../../src/equity/Governor.sol";
import { IGovernor } from "../../../../../src/interfaces/IGovernor.sol";
import { Governor_Shared_Test } from "../../../../utils/Governor/Governor_Shared_Test.sol";

/// @dev Ports Firm Voting.t.sol:66-80 (G-1). The implementation cannot be initialised (N-6, I3).
contract Initialize_Governor_Unit_Concrete_Test is Governor_Shared_Test {
    function test_WhenItIsTheImplementation() external {
        // it should revert with the initializer error
        vm.expectRevert(INVALID_INITIALIZATION);
        vm.prank(users.eve);
        implementation.initialize(
            NAME, IERC5805(address(captable)), address(safe), _allowed(), DELAY, PERIOD, THRESHOLD, QUORUM_BPS
        );
    }

    function test_WhenItWasAlreadyInitialized() external {
        // it should revert with the initializer error
        assertEq(address(governor.token()), address(captable), "initialised in setUp");
        address[] memory evil = new address[](1);
        evil[0] = users.eve;
        vm.expectRevert(INVALID_INITIALIZATION);
        vm.prank(users.eve);
        governor.initialize("Eve", IERC5805(users.eve), users.eve, evil, 1, 1, 0, 1);
        assertEq(governor.votingDelay(), DELAY, "delay kept");
        assertFalse(governor.isAllowedTarget(users.eve), "eve not added");
    }

    modifier whenItIsAFreshClone() {
        _;
    }

    function test_WhenTheCompanySafeIsTheGovernorItself() external whenItIsAFreshClone {
        // it should revert with TargetNotAllowed
        Governor fresh = Governor(payable(Clones.clone(address(implementation))));
        vm.expectRevert(abi.encodeWithSelector(IGovernor.TargetNotAllowed.selector, address(fresh)));
        fresh.initialize(
            NAME, IERC5805(address(captable)), address(fresh), _allowed(), DELAY, PERIOD, THRESHOLD, QUORUM_BPS
        );
    }

    function test_WhenTheAllowedTargetsIncludeTheCompanySafe() external whenItIsAFreshClone {
        // it should revert with TargetNotAllowed
        Governor fresh = Governor(payable(Clones.clone(address(implementation))));
        address[] memory targets = new address[](2);
        targets[0] = address(targetA);
        targets[1] = address(safe);
        vm.expectRevert(abi.encodeWithSelector(IGovernor.TargetNotAllowed.selector, address(safe)));
        fresh.initialize(
            NAME, IERC5805(address(captable)), address(safe), targets, DELAY, PERIOD, THRESHOLD, QUORUM_BPS
        );
    }

    function test_WhenTheTargetsAreValid() external whenItIsAFreshClone {
        Governor fresh = Governor(payable(Clones.clone(address(implementation))));
        fresh.initialize(
            NAME, IERC5805(address(captable)), address(safe), _allowed(), DELAY, PERIOD, THRESHOLD, QUORUM_BPS
        );
        // it should read votes from the given votes contract on its timestamp clock
        assertEq(address(fresh.token()), address(captable), "token");
        assertEq(fresh.clock(), uint48(block.timestamp), "clock");
        assertEq(fresh.CLOCK_MODE(), "mode=timestamp", "clock mode");
        assertEq(fresh.name(), NAME, "name");
        assertEq(fresh.safe(), address(safe), "safe");
        assertEq(fresh.getVotes(users.amira, block.timestamp - 1), AMIRA_VOTES, "votes read from the Captable");
        // it should set the delay and period and threshold and quorum
        assertEq(fresh.votingDelay(), DELAY, "delay");
        assertEq(fresh.votingPeriod(), PERIOD, "period");
        assertEq(fresh.proposalThreshold(), THRESHOLD, "threshold");
        assertEq(fresh.quorumNumerator(), QUORUM_BPS, "quorum numerator");
        assertEq(fresh.quorumDenominator(), 10_000, "basis points");
        // it should add itself to its allowed targets
        assertTrue(fresh.isAllowedTarget(address(fresh)), "itself allowed");
        address[] memory list = fresh.allowedTargets();
        assertEq(list.length, 5, "four plus itself");
        for (uint256 i; i < 4; ++i) {
            assertEq(list[i], _allowed()[i], "order kept");
            assertTrue(fresh.isAllowedTarget(list[i]), "listed is allowed");
        }
        assertEq(list[4], address(fresh), "itself last");
        assertFalse(fresh.isAllowedTarget(address(safe)), "never the Safe");
        assertFalse(fresh.isAllowedTarget(address(roles)), "never Roles");
        // it should start with pendingUntil at 0
        assertEq(fresh.pendingUntil(), 0, "pendingUntil");
    }
}
