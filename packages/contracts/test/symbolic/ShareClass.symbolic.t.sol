// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { Test } from "forge-std/Test.sol";

import { ShareClass } from "../../src/equity/ShareClass.sol";
import { IShareClass } from "../../src/interfaces/IShareClass.sol";
import { MockCaptableForShareClass } from "../utils/ShareClass/MockCaptableForShareClass.sol";

/// @notice Halmos checks for ShareClass (gate 10). fv/halmos.md lists no ShareClass row; these prove the
/// token half of E8 (ruling D5) for every receiver, amount and delegator. Each check first makes one
/// concrete call that must succeed (the vacuity guard), so the reverting stub fails it.
contract ShareClass_Symbolic is Test {
    address internal constant SAFE = address(0x5AFE);
    address internal constant ALICE = address(0xA11CE);

    IShareClass internal token;
    address internal captable;

    function setUp() public {
        captable = address(new MockCaptableForShareClass(SAFE));
        token = IShareClass(Clones.clone(address(new ShareClass())));
    }

    /// @dev The vacuity guard: initialise and mint one share to Alice, which must succeed.
    function _guard() internal {
        try token.initialize("Acme Ltd Common", "ACME.C", captable, 1) { }
        catch {
            assert(false);
        }
        vm.prank(captable);
        try token.mint(ALICE, 1) { }
        catch {
            assert(false);
        }
        assert(token.getVotes(ALICE) == 1);
    }

    /// @dev E8: whoever receives shares by mint or forced move, the Safe never votes, has no delegate, and its
    /// checkpoint equals its balance; every other receiver's votes are its balance.
    function check_E8_safeNeverVotes(address to, uint128 minted, address dst, uint128 moved) public {
        _guard();
        vm.assume(to != address(0) && dst != address(0) && to != dst && to != ALICE && dst != ALICE);
        vm.assume(moved <= minted);
        vm.prank(captable);
        token.mint(to, minted);
        vm.prank(captable);
        token.forcedMove(to, dst, moved);

        assert(token.getVotes(SAFE) == 0);
        assert(token.delegates(SAFE) == address(0));
        assert(token.safeBalanceAt(block.timestamp) == token.balanceOf(SAFE));
        if (dst != SAFE) assert(token.getVotes(dst) == moved);
        if (to != SAFE) assert(token.getVotes(to) == uint256(minted) - moved);
    }

    /// @dev E8: no delegator can lend votes to the Safe; the refusal is `SafeCannotVote`.
    function check_E8_noDelegationToSafe(address delegator) public {
        _guard();
        vm.prank(delegator);
        try token.delegate(SAFE) {
            assert(false);
        } catch (bytes memory reason) {
            assert(bytes4(reason) == IShareClass.SafeCannotVote.selector);
        }
        assert(token.getVotes(SAFE) == 0);
    }

    /// @dev E6 (token half) and T-3: nobody but the Captable mints, burns or force-moves.
    function check_E6_onlyCaptableMoves(address caller, address to, uint128 amount) public {
        _guard();
        vm.assume(caller != captable);
        vm.prank(caller);
        try token.mint(to, amount) {
            assert(false);
        } catch (bytes memory reason) {
            assert(bytes4(reason) == IShareClass.OnlyCaptable.selector);
        }
        vm.prank(caller);
        try token.forcedMove(ALICE, to, 1) {
            assert(false);
        } catch (bytes memory reason) {
            assert(bytes4(reason) == IShareClass.OnlyCaptable.selector);
        }
        assert(token.balanceOf(ALICE) == 1);
    }
}
