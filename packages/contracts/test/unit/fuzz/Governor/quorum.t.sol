// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC5805 } from "@openzeppelin/contracts/interfaces/IERC5805.sol";
import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import {
    GovernorVotesQuorumFractionUpgradeable
} from "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorVotesQuorumFractionUpgradeable.sol";

import { Governor } from "../../../../src/equity/Governor.sol";
import { MockClassVotes } from "../../../utils/Governor/GovernorMocks.sol";
import { Governor_Shared_Test } from "../../../utils/Governor/Governor_Shared_Test.sol";

/// @dev The quorum tree's ranged leaves: any numerator in basis points over any supply, the Safe's shares
/// left out (D5), numerators above 10,000 refused (R1 G-6).
contract Quorum_Governor_Unit_Fuzz_Test is Governor_Shared_Test {
    function _fresh(IERC5805 votes, uint256 numerator) internal returns (Governor g) {
        g = Governor(payable(Clones.clone(address(implementation))));
        g.initialize(NAME, votes, address(safe), _allowed(), DELAY, PERIOD, THRESHOLD, numerator);
    }

    function testFuzz_QuorumIsTheFractionOfSupplyWithoutTheSafe(
        uint128 jordanShares,
        uint128 safeShares,
        uint256 numerator
    )
        external
    {
        numerator = bound(numerator, 0, 10_000);
        if (jordanShares > 0) captable.mint(users.jordan, jordanShares);
        if (safeShares > 0) captable.mint(address(safe), safeShares);
        Governor g = _fresh(IERC5805(address(captable)), numerator);
        vm.warp(block.timestamp + 1);
        uint256 supply = AMIRA_VOTES + BEN_VOTES + uint256(jordanShares);
        assertEq(g.quorum(block.timestamp - 1), supply * numerator / 10_000, "quorum");
    }

    function testFuzz_RevertWhen_TheNumeratorIsAboveTheDenominator(uint256 numerator) external {
        numerator = bound(numerator, 10_001, type(uint256).max);
        Governor g = Governor(payable(Clones.clone(address(implementation))));
        vm.expectRevert(
            abi.encodeWithSelector(
                GovernorVotesQuorumFractionUpgradeable.GovernorInvalidQuorumFraction.selector, numerator, 10_000
            )
        );
        g.initialize(NAME, IERC5805(address(captable)), address(safe), _allowed(), DELAY, PERIOD, THRESHOLD, numerator);
    }

    /// @dev A class Governor reads a ShareClass token, whose past total supply still holds the Safe's shares;
    /// the Governor leaves them out (D5) by the token's `safeBalanceAt` (judgement call, see the plan).
    function testFuzz_ClassGovernorLeavesTheSafeOut(
        uint128 shareholders,
        uint128 safeShares,
        uint256 numerator
    )
        external
    {
        numerator = bound(numerator, 0, 10_000);
        MockClassVotes classVotes = new MockClassVotes(address(safe));
        if (shareholders > 0) classVotes.mint(users.investor, shareholders);
        if (safeShares > 0) classVotes.mint(address(safe), safeShares);
        Governor g = _fresh(IERC5805(address(classVotes)), numerator);
        vm.warp(block.timestamp + 1);
        assertEq(g.quorum(block.timestamp - 1), uint256(shareholders) * numerator / 10_000, "class quorum");
    }
}
