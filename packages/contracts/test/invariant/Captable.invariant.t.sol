// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { console2 } from "forge-std/console2.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { ICaptable } from "../../src/interfaces/ICaptable.sol";
import { Captable_Test } from "../utils/Captable/Captable_Test.sol";
import { MockShareClass } from "../utils/Captable/CaptableMocks.sol";
import { CaptableAttackerHandler } from "./handlers/CaptableAttackerHandler.sol";
import { CaptableHandler } from "./handlers/CaptableHandler.sol";

/// @notice Invariants E1, E3, E4, E7, E8, E9, E10, E11 and I3 (invariants.md, "Equity") over two handlers:
/// the honest company (the Board's Safe, the company Governor, Rounds, Vesting and the shareholders Amira,
/// Ben, Alice, Bob and the investor) and Eve the attacker, who also plays the Board doing what it may not do
/// alone. E2 is Certora's (who may call what); Eve's handler checks it here too.
contract Captable_Invariant_Test is Captable_Test {
    CaptableHandler internal handler;
    CaptableAttackerHandler internal attacker;

    function setUp() public override {
        super.setUp();
        address[] memory shareholders = new address[](5);
        shareholders[0] = users.amira;
        shareholders[1] = users.ben;
        shareholders[2] = users.alice;
        shareholders[3] = users.bob;
        shareholders[4] = users.investor;
        handler = new CaptableHandler(captable, governor, vesting, address(safe), exits, rounds, shareholders);
        attacker = new CaptableAttackerHandler(captable, handler, governor, users.eve);

        try handler.sync() { } catch { } // red stub: the invariants fail on their own reads
        targetContract(address(handler));
        targetContract(address(attacker));
        vm.label(address(handler), "CaptableHandler");
        vm.label(address(attacker), "Eve (attacker handler)");
    }

    /// @dev E1: issued plus convertible reserve never exceeds authorised, in every class.
    function invariant_E1_authorised() external view {
        for (uint8 c; c < captable.numberOfClasses(); ++c) {
            ICaptable.Class memory cl = captable.getClass(c);
            assertLe(cl.token.totalSupply() + captable.convertibleReserved(c), cl.authorised, "E1");
        }
    }

    /// @dev E3 (the sum): every account's votes are the weighted, as-converted sum of its class votes, and
    /// votes recorded at a past timepoint never change (Firm C-12).
    function invariant_E3_votesAreTheWeightedSum() external view {
        address[] memory accounts = handler.shareholders();
        for (uint256 i; i < accounts.length; ++i) {
            uint256 expected;
            for (uint8 c; c < captable.numberOfClasses(); ++c) {
                ICaptable.Class memory cl = captable.getClass(c);
                expected += _classVotes(
                    cl.weight,
                    cl.token.getVotes(accounts[i]),
                    cl.originalIssuePrice,
                    captable.conversionPriceAt(c, vm.getBlockTimestamp())
                );
            }
            assertEq(captable.getVotes(accounts[i]), expected, "E3 sum");
        }
        CaptableHandler.Record[] memory records = handler.records();
        for (uint256 i; i < records.length; ++i) {
            assertEq(captable.getPastVotes(records[i].account, records[i].timepoint), records[i].votes, "E3 past");
        }
        records = handler.supplyRecords();
        for (uint256 i; i < records.length; ++i) {
            assertEq(captable.getPastTotalSupply(records[i].timepoint), records[i].votes, "E3 past supply");
        }
    }

    /// @dev E4: a conversion price is what the last lowering set, never above the issue price nor below the floor.
    function invariant_E4_priceOnlyFalls() external view {
        assertFalse(attacker.boardLoweredPrice(), "F8: the Board alone lowered a price");
        for (uint8 c; c < captable.numberOfClasses(); ++c) {
            ICaptable.Class memory cl = captable.getClass(c);
            if (cl.originalIssuePrice == 0) continue;
            uint128 cp = captable.conversionPriceAt(c, vm.getBlockTimestamp());
            assertEq(cp, handler.ghostPrice(c), "E4 last lowering");
            assertLe(cp, cl.originalIssuePrice, "E4 never rises");
            assertGe(cp, cl.conversionFloorPrice, "E4 floor");
        }
    }

    /// @dev E7 (and E2): every balance is exactly what the permitted moves say. Eve never took, issued or
    /// changed anything, and the Safe never forced a transfer without consent.
    function invariant_E7_sharesMoveOnlyByTheRules() external view {
        assertFalse(attacker.eveWon(), "E2/E7: Eve succeeded");
        assertFalse(attacker.forcedWithoutConsent(), "E7: forced transfer without consent");
        address[] memory all = handler.holders();
        for (uint8 c; c < captable.numberOfClasses(); ++c) {
            MockShareClass token = MockShareClass(address(captable.getClass(c).token));
            for (uint256 i; i < all.length; ++i) {
                assertEq(token.balanceOf(all[i]), handler.ghostBalance(c, all[i]), "E7 balance");
            }
            assertEq(token.balanceOf(users.eve), 0, "E7: Eve holds nothing");
        }
    }

    /// @dev E8 (D5): the Safe has no votes, and its shares are out of the supply at every past timepoint.
    function invariant_E8_safeHasNoVotes() external view {
        assertEq(captable.getVotes(address(safe)), 0, "E8 votes now");
        uint256 t = vm.getBlockTimestamp() - 1;
        assertEq(captable.getPastVotes(address(safe), t), 0, "E8 past votes");
        uint256 expected;
        for (uint8 c; c < captable.numberOfClasses(); ++c) {
            ICaptable.Class memory cl = captable.getClass(c);
            if (cl.weight == 0) continue;
            MockShareClass token = MockShareClass(address(cl.token));
            uint256 counted = token.getPastTotalSupply(t) - token.safeBalanceAt(t);
            expected += _classVotes(cl.weight, counted, cl.originalIssuePrice, captable.conversionPriceAt(c, t));
        }
        assertEq(captable.getPastTotalSupply(t), expected, "E8 supply leaves the Safe out");
    }

    /// @dev E9 (N-4): vote reads never revert, and every class stays under the vote bound.
    function invariant_E9_voteReadsNeverRevert() external view {
        address[] memory all = handler.holders();
        for (uint256 i; i < all.length; ++i) {
            try captable.getVotes(all[i]) { }
            catch {
                assertTrue(false, "E9 getVotes reverted");
            }
            try captable.getPastVotes(all[i], vm.getBlockTimestamp() - 1) { }
            catch {
                assertTrue(false, "E9 getPastVotes reverted");
            }
        }
        try captable.getPastTotalSupply(vm.getBlockTimestamp() - 1) { }
        catch {
            assertTrue(false, "E9 getPastTotalSupply reverted");
        }
        for (uint8 c; c < captable.numberOfClasses(); ++c) {
            ICaptable.Class memory cl = captable.getClass(c);
            uint256 maxVotes = cl.originalIssuePrice == 0
                ? uint256(cl.weight) * cl.authorised
                : Math.mulDiv(uint256(cl.weight) * cl.authorised, cl.originalIssuePrice, cl.conversionFloorPrice);
            assertLe(maxVotes, MAX_CLASS_VOTES, "E9 bound");
        }
    }

    /// @dev E10 (N-5): authorised moves only by setAuthorised and by conversions out of the class.
    function invariant_E10_convertLowersSource() external view {
        for (uint8 c; c < captable.numberOfClasses(); ++c) {
            assertEq(captable.getClass(c).authorised, handler.ghostAuthorised(c), "E10");
        }
    }

    /// @dev E11 (D6): no share was issued into a voting class while a proposal was pending.
    function invariant_E11_noIssueWhilePending() external view {
        assertFalse(attacker.issuedWhilePending(), "E11");
        assertFalse(attacker.pendingWrongRefusal(), "E11: refused, but not with ProposalPending");
    }

    /// @dev I3 (N-6): the implementation can never be initialised.
    function invariant_I3_implementationNotInitialisable() external {
        (bool ok, bytes memory reason) =
            address(captableImpl).call(abi.encodeCall(ICaptable.initialize, (COMPANY, _wiring(), _templateClasses())));
        assertFalse(ok, "I3: the implementation was initialised");
        // Refused because it is already initialised, not for any other reason (a stub's revert is no proof).
        assertEq(reason, abi.encodeWithSelector(ICaptable.AlreadyInitialized.selector), "I3: wrong refusal");
    }

    /// @dev The call summary: a handler that is never reached is a gap, not a pass (invariants.md).
    function afterInvariant() external view {
        bytes32[13] memory honest = [
            bytes32("issue"),
            "createClass",
            "setAuthorised",
            "freeze",
            "lowerPrice",
            "burnUnvested",
            "setLock",
            "propose",
            "warp",
            "transfer",
            "convert",
            "consentAndForce",
            "governorForce"
        ];
        for (uint256 i; i < honest.length; ++i) {
            console2.log(string(abi.encodePacked(honest[i])), handler.calls(honest[i]));
        }
        bytes32[7] memory eve = [
            bytes32("eveIssue"),
            "eveForcedTransfer",
            "eveReservedMatter",
            "eveTakesShares",
            "safeForcesWithoutConsent",
            "safeLowersPrice",
            "issueWhilePending"
        ];
        for (uint256 i; i < eve.length; ++i) {
            console2.log(string(abi.encodePacked(eve[i])), attacker.calls(eve[i]));
        }
    }
}
