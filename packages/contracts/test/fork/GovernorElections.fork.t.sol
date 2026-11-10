// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC5805 } from "@openzeppelin/contracts/interfaces/IERC5805.sol";
import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";

import { Governor } from "../../src/equity/Governor.sol";
import { IGovernor } from "../../src/interfaces/IGovernor.sol";
import { IHats as IHatsAdmin } from "../../src/interfaces/external/IHats.sol";
import { IHatsElectionEligibility } from "../../src/interfaces/external/IHatsElectionEligibility.sol";
import { IHatsModuleFactory } from "../../src/interfaces/external/IHatsModuleFactory.sol";
import { IHatsSignerGate as IGate } from "../../src/interfaces/external/IHatsSignerGate.sol";
import { MockCaptableVotes } from "../utils/Governor/GovernorMocks.sol";
import { Addresses } from "./Addresses.sol";
import { Fork_Test } from "./Fork_Test.t.sol";

/// @dev Hats Signer Gate v2's threshold read (not in our interface).
interface IGateThreshold {
    function thresholdConfig() external view returns (IGate.ThresholdConfig memory);
}

/// @notice The company Governor deciding reserved matters on the real Hats, Hats Signer Gate v2 and Hats
/// Elections (spec/governor.md "Reserved matters", rulings D2, D15, Q4): it wears the Shareholders' top hat
/// (the Gate's owner hat and the Director hat's admin) and the ballot-box hat, attaches Elections to the
/// mutable Director hat, elects and recalls Directors, sets the Board's threshold range, runs the next term
/// across the term gap, and can never name the company Safe or Roles as a target (G1).
///
/// The votes contract is the hermetic mock Captable (the Captable is W3's); the founder votes from her own
/// Safe (pranked here, as her Safe's `execTransaction` would call).
contract GovernorElections_Fork_Test is Fork_Test {
    IHatsAdmin internal constant HATS_ADMIN = IHatsAdmin(Addresses.HATS);

    Governor internal governor;
    MockCaptableVotes internal votes;
    IHatsElectionEligibility internal elections;
    uint256 internal ballotHat;
    uint128 internal firstTermEnd;

    function setUp() public override {
        super.setUp();
        votes = new MockCaptableVotes(address(companySafe));
        votes.mint(address(founderSafe), 600);
        votes.mint(users.ben, 300);
        votes.mint(address(companySafe), 100);
        firstTermEnd = uint128(block.timestamp + 60 days);

        // The ballot box under the Shareholders' top hat; Elections watch the Director hat (R3 section 1).
        vm.prank(shareholders);
        ballotHat = HATS_ADMIN.createHat(topHat, "Ballot box", 1, noModule, noModule, true, "");
        elections = IHatsElectionEligibility(
            IHatsModuleFactory(Addresses.HATS_MODULE_FACTORY)
                .createHatsModule(
                    Addresses.HATS_ELECTION_ELIGIBILITY,
                    directorHat,
                    abi.encodePacked(ballotHat, topHat),
                    abi.encode(firstTermEnd),
                    0
                )
        );
        vm.label(address(elections), "Hats Elections");

        governor = Governor(payable(Clones.clone(address(new Governor()))));
        vm.label(address(governor), "Governor");
        address[] memory allowed = new address[](3);
        allowed[0] = Addresses.HATS;
        allowed[1] = address(gate);
        allowed[2] = address(elections);
        // Red first: on the stub this reverts and each test fails on its own first call into the Governor.
        try governor.initialize(
            "Acme Ltd Shareholders", IERC5805(address(votes)), address(companySafe), allowed, 1 days, 7 days, 9, 5000
        ) { }
            catch { }

        // The equity install's hand-over (F4): the ballot box, then the top hat, go to the Governor.
        vm.startPrank(shareholders);
        HATS_ADMIN.mintHat(ballotHat, address(governor));
        HATS_ADMIN.transferHat(topHat, shareholders, address(governor));
        vm.stopPrank();
        vm.warp(block.timestamp + 1);
    }

    // ------------------------------------------------------------------ helpers

    function _enact(address[] memory targets, bytes[] memory calldatas, string memory description) internal {
        vm.prank(address(founderSafe));
        uint256 id = governor.propose(targets, new uint256[](targets.length), calldatas, description);
        vm.warp(governor.proposalSnapshot(id) + 1);
        vm.prank(address(founderSafe));
        governor.castVote(id, 1);
        vm.warp(governor.proposalDeadline(id) + 1);
        governor.execute(targets, new uint256[](targets.length), calldatas, keccak256(bytes(description)));
    }

    function _founder() internal view returns (address[] memory winners) {
        winners = new address[](1);
        winners[0] = address(founderSafe);
    }

    /// @dev Elect the founder's Safe for the first term, then attach Elections to the Director hat (D2): in one
    /// proposal, election first, so the sitting Director never loses eligibility.
    function _attachElections() internal {
        address[] memory targets = new address[](2);
        bytes[] memory calldatas = new bytes[](2);
        targets[0] = address(elections);
        calldatas[0] = abi.encodeCall(IHatsElectionEligibility.elect, (firstTermEnd, _founder()));
        targets[1] = Addresses.HATS;
        calldatas[1] = abi.encodeCall(IHatsAdmin.changeHatEligibility, (directorHat, address(elections)));
        _enact(targets, calldatas, "attach elections");
    }

    // ------------------------------------------------------------------ tests

    function test_ElectsAndRecallsDirectors() external {
        _attachElections();
        assertTrue(HATS.isWearerOfHat(address(founderSafe), directorHat), "elected Director wears the hat");
        assertTrue(gate.isValidSigner(address(founderSafe)), "elected Director signs");

        address[] memory targets = new address[](1);
        bytes[] memory calldatas = new bytes[](1);
        targets[0] = address(elections);
        calldatas[0] = abi.encodeCall(IHatsElectionEligibility.recall, (firstTermEnd, _founder()));
        _enact(targets, calldatas, "recall the founder");
        assertFalse(HATS.isWearerOfHat(address(founderSafe), directorHat), "recalled Director is out");
        assertFalse(gate.isValidSigner(address(founderSafe)), "recalled Director cannot sign");
    }

    function test_SetsTheBoardThresholdRange() external {
        address[] memory targets = new address[](1);
        bytes[] memory calldatas = new bytes[](1);
        targets[0] = address(gate);
        calldatas[0] = abi.encodeCall(
            IGate.setThresholdConfig,
            (IGate.ThresholdConfig({ thresholdType: IGate.TargetThresholdType.ABSOLUTE, min: 1, target: 2 }))
        );
        _enact(targets, calldatas, "threshold range");
        IGate.ThresholdConfig memory config = IGateThreshold(address(gate)).thresholdConfig();
        assertEq(config.min, 1, "min");
        assertEq(config.target, 2, "target");
    }

    function test_NeverTheSafeOrRoles() external {
        address[] memory targets = new address[](1);
        targets[0] = address(companySafe);
        vm.expectRevert(abi.encodeWithSelector(IGovernor.TargetNotAllowed.selector, address(companySafe)));
        vm.prank(address(founderSafe));
        governor.propose(targets, new uint256[](1), new bytes[](1), "the Safe");

        targets[0] = address(companyRoles);
        vm.expectRevert(abi.encodeWithSelector(IGovernor.TargetNotAllowed.selector, address(companyRoles)));
        vm.prank(address(founderSafe));
        governor.propose(targets, new uint256[](1), new bytes[](1), "Roles");
    }

    /// @dev Ruling D15: elect the next term before the current one ends; at the boundary every Director is
    /// ineligible until anyone calls `startNextTerm`, which cannot be called early.
    function test_RunsTheNextTermAcrossTheGap() external {
        _attachElections();
        uint128 nextTermEnd = firstTermEnd + 365 days;
        address[] memory targets = new address[](2);
        bytes[] memory calldatas = new bytes[](2);
        targets[0] = address(elections);
        calldatas[0] = abi.encodeCall(IHatsElectionEligibility.setNextTerm, (nextTermEnd));
        targets[1] = address(elections);
        calldatas[1] = abi.encodeCall(IHatsElectionEligibility.elect, (nextTermEnd, _founder()));
        _enact(targets, calldatas, "next term");
        assertLt(block.timestamp, firstTermEnd, "elected before the term ends");

        vm.expectRevert();
        elections.startNextTerm();

        vm.warp(firstTermEnd);
        assertFalse(HATS.isWearerOfHat(address(founderSafe), directorHat), "the gap: nobody is eligible");
        assertFalse(gate.isValidSigner(address(founderSafe)), "the gap: nobody signs");

        vm.prank(users.eve);
        elections.startNextTerm();
        assertEq(elections.currentTermEnd(), nextTermEnd, "next term started");
        assertTrue(HATS.isWearerOfHat(address(founderSafe), directorHat), "re-elected Director is back");
        assertTrue(gate.isValidSigner(address(founderSafe)), "re-elected Director signs again");
    }
}
