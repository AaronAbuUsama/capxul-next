// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { console2 } from "forge-std/console2.sol";

import { IOptions } from "../../src/interfaces/IOptions.sol";
import { Options_Shared_Test } from "../utils/Options/Options_Shared_Test.sol";
import { OptionsAttackerHandler } from "./handlers/OptionsAttackerHandler.sol";
import { OptionsHandler } from "./handlers/OptionsHandler.sol";

/// @notice Options invariants O1, O2 (sum and headroom), I3 and the strike's payment (kind 7 to the Safe, Options
/// holds nothing), over the Board, three grantees and eve.
contract Options_Invariant_Test is Options_Shared_Test {
    OptionsHandler internal handler;
    OptionsAttackerHandler internal attacker;

    function setUp() public override {
        super.setUp();
        address[] memory grantees = new address[](3);
        grantees[0] = users.alice;
        grantees[1] = users.bob;
        grantees[2] = users.jordan;
        vm.prank(users.jordan);
        usdc.approve(address(options), type(uint256).max);
        handler = new OptionsHandler(options, captable, usdc, address(safe), grantees);
        attacker = new OptionsAttackerHandler(options, implementation, handler, users.eve, address(usdc));
        targetContract(address(handler));
        targetContract(address(attacker));
        excludeSender(address(safe));
    }

    /// @dev O1: no grant has exercised more than has vested.
    function invariant_O1_exercisedBounded() external view {
        uint256 n = handler.idsLength();
        for (uint256 i; i < n; ++i) {
            uint256 id = handler.ids(i);
            IOptions.OptionGrant memory g = options.getGrant(id);
            assertLe(g.exercised, options.vestedOf(id, uint64(block.timestamp)), "O1 exercised <= vested");
            assertLe(g.exercised, handler.model(g, uint64(block.timestamp)), "O1 against the model");
        }
    }

    /// @dev O2: `allocated` equals the live grants' unexercised options (only the vested part once ended), the
    /// handler's own figure, and never exceeds the pool.
    function invariant_O2_allocatedIsTheLiveSum() external view {
        uint256 n = handler.idsLength();
        uint256 sum;
        for (uint256 i; i < n; ++i) {
            IOptions.OptionGrant memory g = options.getGrant(handler.ids(i));
            if (g.cancelled) continue;
            sum += (g.endedAt != 0 ? handler.model(g, g.endedAt) : g.shares) - g.exercised;
        }
        assertEq(options.allocated(), sum, "O2 allocated == live sum");
        assertEq(options.allocated(), handler.ghostAllocated(), "O2 allocated == model");
        assertLe(options.allocated(), options.pool(), "O2 allocated <= pool");
    }

    /// @dev O2 headroom: the pool fits the class's authorised headroom and equals Options' issuer allowance, which
    /// exercise spends in step with the pool (F9).
    function invariant_O2_poolFitsHeadroom() external view {
        assertLe(uint256(options.pool()), uint256(captable.authorised(COMMON) - captable.issued(COMMON)), "O2 headroom");
        assertEq(options.pool(), captable.issuerAllowance(address(options), COMMON), "pool == issuer allowance");
        assertEq(captable.issued(COMMON), handler.ghostExercised(), "issued == exercised");
    }

    /// @dev The strike: every exercise paid exactly shares x strike to the Safe, and Options holds nothing.
    function invariant_strikePaidToTheSafe() external view {
        assertEq(usdc.balanceOf(address(safe)), 1_000_000 * USDC_UNIT + handler.ghostStrikePaid(), "strike to Safe");
        _assertHoldsNothing();
    }

    /// @dev I3: the implementation was never initialised and cannot be.
    function invariant_I3_implementationSealed() external {
        try implementation.initialize(address(safe), address(captable), address(payments), COMMON) {
            fail();
        } catch (bytes memory reason) {
            assertEq(bytes4(reason), IOptions.AlreadyInitialized.selector, "I3 sealed");
        }
    }

    function invariant_eveNeverWins() external view {
        assertFalse(attacker.ghostEveWon(), "eve won");
        assertEq(common.balanceOf(users.eve), 0, "eve holds no shares");
    }

    function afterInvariant() external view {
        console2.log("setPool", handler.calls("setPool"));
        console2.log("grant", handler.calls("grant"));
        console2.log("accept", handler.calls("accept"));
        console2.log("exercise", handler.calls("exercise"));
        console2.log("end", handler.calls("end"));
        console2.log("lapse", handler.calls("lapse"));
        console2.log("warp", handler.calls("warp"));
        console2.log("endAllForExit", handler.calls("endAllForExit"));
        console2.log("eve attempts", attacker.attempts());
    }
}
