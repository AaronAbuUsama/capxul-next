// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";

import { IOptions } from "../../../src/interfaces/IOptions.sol";
import { OptionsHandler } from "./OptionsHandler.sol";

/// @notice Eve the attacker, who wears nothing and holds USDC: she tries every guarded Options call (H4, the
/// grantee checks, `OnlyExits`, I3). Every call here must be refused; a success sets `ghostEveWon`, which
/// `invariant_eveNeverWins` reads. Calls are wrapped in try so the expected refusals do not trip `fail_on_revert`.
contract OptionsAttackerHandler is Test {
    IOptions internal immutable options;
    IOptions internal immutable implementation;
    OptionsHandler internal immutable honest;
    address internal immutable eve;
    address internal immutable usdc;

    bool public ghostEveWon;
    uint256 public attempts;

    constructor(IOptions options_, IOptions implementation_, OptionsHandler honest_, address eve_, address usdc_) {
        options = options_;
        implementation = implementation_;
        honest = honest_;
        eve = eve_;
        usdc = usdc_;
    }

    function _id(uint256 seed) internal view returns (uint256) {
        uint256 n = honest.idsLength();
        return n == 0 ? 1 : honest.ids(bound(seed, 0, n - 1));
    }

    function setPoolAsEve(uint128 amount) external {
        attempts++;
        vm.prank(eve);
        try options.setPool(amount) {
            ghostEveWon = true;
        } catch { }
    }

    function grantToSelf(uint128 shares) external {
        attempts++;
        uint64 t = uint64(block.timestamp);
        vm.prank(eve);
        try options.grant(eve, shares, usdc, 0, t, t, t, t + 1, t + 1, 0, bytes32(uint256(1))) {
            ghostEveWon = true;
        } catch { }
    }

    function endAsEve(uint256 seed) external {
        attempts++;
        vm.prank(eve);
        try options.end(_id(seed), uint64(block.timestamp)) {
            ghostEveWon = true;
        } catch { }
    }

    function acceptAsEve(uint256 seed, bytes32 termsHash) external {
        attempts++;
        vm.prank(eve);
        try options.accept(_id(seed), termsHash) {
            ghostEveWon = true;
        } catch { }
    }

    function exerciseAsEve(uint256 seed, uint128 n) external {
        attempts++;
        vm.prank(eve);
        try options.exercise(_id(seed), uint128(bound(n, 1, 1e9))) {
            ghostEveWon = true;
        } catch { }
    }

    function endAllAsEve() external {
        attempts++;
        vm.prank(eve);
        try options.endAllForExit() {
            ghostEveWon = true;
        } catch { }
    }

    function reinitialise(bool impl, address wiring) external {
        attempts++;
        vm.prank(eve);
        try (impl ? implementation : options).initialize(wiring, wiring, wiring, 0) {
            ghostEveWon = true;
        } catch { }
    }
}
