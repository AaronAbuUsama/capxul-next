// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { console2 } from "forge-std/console2.sol";

import { IShareClass } from "../../src/interfaces/IShareClass.sol";
import { ShareClass_Shared_Test } from "../utils/ShareClass/ShareClass_Shared_Test.sol";
import { ShareClassAttackerHandler } from "./handlers/ShareClassAttackerHandler.sol";
import { ShareClassHandler } from "./handlers/ShareClassHandler.sol";

/// @notice ShareClass invariants E8 (the Safe's shares never vote and are tracked out of supply) and I3 (the
/// implementation is sealed), over one class token whose Captable allows every transfer.
contract ShareClass_Invariant_Test is ShareClass_Shared_Test {
    ShareClassHandler internal handler;
    ShareClassAttackerHandler internal attacker;

    function setUp() public override {
        super.setUp();
        address[] memory shareholders = new address[](6);
        shareholders[0] = users.amira;
        shareholders[1] = users.ben;
        shareholders[2] = users.jordan;
        shareholders[3] = users.alice;
        shareholders[4] = users.bob;
        shareholders[5] = users.investor;
        handler = new ShareClassHandler(token, address(captable), address(safe), shareholders);
        attacker = new ShareClassAttackerHandler(
            token, IShareClass(address(implementation)), users.eve, address(safe), shareholders
        );
        // Founders start with shares and the Safe with treasury shares (the co-founders template). Tried, so
        // that on the stub each invariant reports its own NotImplemented failure rather than one setUp failure.
        vm.startPrank(address(captable));
        try token.mint(users.amira, 5_000_000) { } catch { }
        try token.mint(users.ben, 3_000_000) { } catch { }
        try token.mint(address(safe), 1_000_000) { } catch { }
        vm.stopPrank();

        targetContract(address(handler));
        targetContract(address(attacker));
        excludeSender(address(token));
        excludeSender(address(implementation));
        excludeSender(address(captable));
        excludeSender(address(safe));
    }

    /// @dev E8: `votes(safe, t) = 0`, and the Safe has no delegate.
    function invariant_E8_safeHasNoVotes() external view {
        assertEq(token.getVotes(address(safe)), 0, "safe votes");
        assertEq(token.delegates(address(safe)), address(0), "safe delegate");
    }

    /// @dev E8: `safeBalanceAt(now) == balanceOf(safe)`, and every recorded past balance reads back.
    function invariant_E8_safeBalanceTracked() external view {
        assertEq(token.safeBalanceAt(vm.getBlockTimestamp()), token.balanceOf(address(safe)), "now");
        uint256 n = handler.ghostCount();
        for (uint256 i; i < n; ++i) {
            assertEq(token.safeBalanceAt(handler.ghostTimes(i)), handler.ghostSafeBalances(i), "history");
        }
    }

    /// @dev E8: every vote that exists belongs to a shareholder; the votes add up to the supply less the Safe's.
    function invariant_E8_votesAreSupplyLessSafe() external view {
        uint256 votes;
        uint256 balances;
        uint256 n = handler.holderCount();
        for (uint256 i; i < n; ++i) {
            address h = handler.holderAt(i);
            votes += token.getVotes(h);
            balances += token.balanceOf(h);
        }
        assertEq(balances, token.totalSupply(), "balances sum to supply");
        assertEq(votes, token.totalSupply() - token.balanceOf(address(safe)), "votes = supply - safe");
    }

    /// @dev I3: the implementation was never initialised and holds nothing.
    function invariant_I3_implementationSealed() external view {
        assertEq(implementation.captable(), address(0), "implementation captable");
        assertEq(implementation.totalSupply(), 0, "implementation supply");
    }

    /// @dev Eve (and the Safe trying to vote) never succeeds at anything guarded.
    function invariant_eveNeverWins() external view {
        assertFalse(attacker.ghostEveWon(), "eve won");
        assertEq(token.balanceOf(users.eve), 0, "eve holds nothing");
    }

    function afterInvariant() external view {
        console2.log("mint", handler.calls(keccak256("mint")));
        console2.log("burn", handler.calls(keccak256("burn")));
        console2.log("forcedMove", handler.calls(keccak256("forcedMove")));
        console2.log("transfer", handler.calls(keccak256("transfer")));
        console2.log("transferFrom", handler.calls(keccak256("transferFrom")));
        console2.log("delegate", handler.calls(keccak256("delegate")));
        console2.log("warp", handler.calls(keccak256("warp")));
        console2.log("attacker attempts", attacker.attempts());
    }
}
