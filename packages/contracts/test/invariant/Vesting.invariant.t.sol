// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IVesting } from "../../src/interfaces/IVesting.sol";
import { Vesting_Shared_Test } from "../utils/Vesting/Vesting_Shared_Test.sol";
import { VestingAttackerHandler } from "./handlers/VestingAttackerHandler.sol";
import { VestingHandler } from "./handlers/VestingHandler.sol";

/// @notice Vesting invariants V1 to V5 (invariants.md, Equity) over one company's Common class: the Board (the
/// company Safe) grants, offers, revokes and accelerates; Exits accelerates; Amira, Ben, Alice and Bob accept
/// offers and move free shares; the investor gives shares; Eve attacks every guarded function.
contract Vesting_Invariant_Test is Vesting_Shared_Test {
    VestingHandler internal handler;
    VestingAttackerHandler internal attacker;
    address[] internal holders;

    function setUp() public override {
        super.setUp();
        holders.push(users.amira);
        holders.push(users.ben);
        holders.push(users.alice);
        holders.push(users.bob);
        // The investor holds plain shares to give (transfer in, V5).
        _issue(users.investor, 10_000_000);
        handler = new VestingHandler(vesting, captable, users.investor, holders);
        attacker = new VestingAttackerHandler(handler, users.eve);
        vm.label(address(handler), "VestingHandler");
        vm.label(address(attacker), "VestingAttackerHandler");
        // The founders' grants (startup story M6), tried so that on the stub each invariant reports its own
        // NotImplemented failure rather than one setUp failure.
        try handler.grantAndIssue(0, 1_000_000, 0, 12, 48, true) { } catch { }
        try handler.grantAndIssue(1, 600_000, 0, 12, 48, false) { } catch { }

        targetContract(address(handler));
        targetContract(address(attacker));
        excludeSender(address(vesting));
        excludeSender(address(captable));
        excludeSender(address(safe));
    }

    /// @dev V1: a live grant's locked amount never rose between two handler steps, and from now on it can only
    /// fall: locked(now) >= locked(now + 1 month) >= locked(now + 5 years).
    function invariant_V1_lockedNeverIncreases() external view {
        assertFalse(handler.v1Breach(), "locked rose between steps");
        uint64 t = uint64(vm.getBlockTimestamp());
        for (uint256 i; i < holders.length; ++i) {
            uint128 a = _locked(holders[i], t);
            uint128 b = _locked(holders[i], t + 31 days);
            uint128 c = _locked(holders[i], t + 5 * 365 days);
            assertGe(a, b, "locked rises within a month");
            assertGe(b, c, "locked rises later");
        }
    }

    /// @dev V2: every shareholder's balance of the class covers their locked amount.
    function invariant_V2_balanceCoversLock() external view {
        uint64 t = uint64(vm.getBlockTimestamp());
        IERC20 token = IERC20(address(_token(COMMON)));
        for (uint256 i; i < holders.length; ++i) {
            assertGe(token.balanceOf(holders[i]), _locked(holders[i], t), "balance below locked");
        }
    }

    /// @dev V3: every revocation takes effect at or after the moment it was made.
    function invariant_V3_revocationNotInPast() external view {
        assertFalse(handler.v3Breach(), "a revoke into the past succeeded");
        uint256 n = handler.idCount();
        for (uint256 i; i < n; ++i) {
            uint256 id = handler.ids(i);
            if (handler.lapsed(id)) continue;
            IVesting.Grant memory g = vesting.getGrant(id);
            if (g.revokedAt != 0) assertGe(g.revokedAt, handler.revokeCalledAt(id), "revoked in the past");
        }
    }

    /// @dev V4: a shareholder's shares are locked only by a grant that came with its own issue, or that the
    /// shareholder accepted themselves; an offer never locks; Eve never made, offered or accepted a grant.
    function invariant_V4_noLockWithoutAcceptance() external view {
        assertFalse(attacker.breach(), attacker.breachedBy());
        uint64 t = uint64(vm.getBlockTimestamp());
        for (uint256 i; i < holders.length; ++i) {
            address s = holders[i];
            uint256 id = vesting.grantOf(address(captable), COMMON, s);
            if (_locked(s, t) == 0) continue;
            assertTrue(id != 0, "locked without a live grant");
            assertTrue(vesting.getGrant(id).accepted, "an offer locks");
            assertTrue(handler.origin(id) == 1 || handler.acceptedBy(id) == s, "locked without the shareholder");
        }
        uint256 n = handler.idCount();
        for (uint256 i; i < n; ++i) {
            uint256 id = handler.ids(i);
            if (handler.lapsed(id)) continue;
            if (!vesting.getGrant(id).accepted) assertEq(handler.acceptedBy(id), address(0), "accepted flag lost");
        }
    }

    /// @dev V5: receiving shares (an issue or a transfer in) never lowered the receiver's locked amount.
    function invariant_V5_receivingNeverLowersLocked() external view {
        assertFalse(handler.v5Breach(), "receiving shares lowered locked");
    }
}
