// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";

import { IShareClass } from "../../../src/interfaces/IShareClass.sol";

/// @notice Eve, who wears nothing and holds nothing, and the Safe trying to vote. Every call here must be
/// refused; a success sets `ghostEveWon`, which `invariant_eveNeverWins` reads. Calls are wrapped in try so
/// the expected refusals do not trip `fail_on_revert`.
contract ShareClassAttackerHandler is Test {
    IShareClass internal immutable token;
    IShareClass internal immutable implementation;
    address internal immutable eve;
    address internal immutable safe;
    address[] internal victims;

    bool public ghostEveWon;
    uint256 public attempts;

    constructor(IShareClass token_, IShareClass implementation_, address eve_, address safe_, address[] memory v) {
        token = token_;
        implementation = implementation_;
        eve = eve_;
        safe = safe_;
        victims = v;
    }

    function _victim(uint256 seed) internal view returns (address) {
        return victims[bound(seed, 0, victims.length - 1)];
    }

    function _won() internal {
        ghostEveWon = true;
    }

    function mintAsEve(uint256 amount) external {
        attempts++;
        vm.prank(eve);
        try token.mint(eve, bound(amount, 1, 1e12)) {
            _won();
        } catch { }
    }

    function burnAsEve(uint256 seed, uint256 amount) external {
        attempts++;
        address v = _victim(seed);
        vm.prank(eve);
        try token.burn(v, bound(amount, 1, 1e12)) {
            _won();
        } catch { }
    }

    function forcedMoveAsEve(uint256 seed, uint256 amount) external {
        attempts++;
        address v = _victim(seed);
        uint256 b = token.balanceOf(v);
        if (b == 0) return;
        vm.prank(eve);
        try token.forcedMove(v, eve, bound(amount, 1, b)) {
            _won();
        } catch { }
    }

    function stealWithoutAllowance(uint256 seed, uint256 amount) external {
        attempts++;
        address v = _victim(seed);
        uint256 b = token.balanceOf(v);
        if (b == 0 || token.allowance(v, eve) >= b) return;
        vm.prank(eve);
        try token.transferFrom(v, eve, bound(amount, token.allowance(v, eve) + 1, b)) {
            _won();
        } catch { }
    }

    function reinitialize() external {
        attempts++;
        vm.prank(eve);
        try token.initialize("Eve", "EVE", eve, 0) {
            _won();
        } catch { }
    }

    /// @dev I3: the implementation behind every clone can neither be initialised nor used.
    function useImplementation(uint256 amount) external {
        attempts++;
        vm.prank(eve);
        try implementation.initialize("Eve", "EVE", eve, 0) {
            _won();
        } catch { }
        vm.prank(eve);
        try implementation.mint(eve, bound(amount, 1, 1e12)) {
            _won();
        } catch { }
    }

    /// @dev D5: nobody lends votes to the Board, and the Safe never delegates.
    function delegateToSafe(uint256 seed) external {
        attempts++;
        vm.prank(_victim(seed));
        try token.delegate(safe) {
            _won();
        } catch { }
    }

    function safeDelegates(uint256 seed) external {
        attempts++;
        vm.prank(safe);
        try token.delegate(_victim(seed)) {
            _won();
        } catch { }
    }
}
