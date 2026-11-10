// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";

import { Installer, InstallerConfig } from "../../src/authority/Installer.sol";

/// @notice Halmos (gate 10) for the Installer. fv/halmos.md lists no Installer row: its invariants (I1, I2, H7, H8,
/// B10) live in third-party state and are fork tests. The one piece of pure maths is the payout ceiling's key, which
/// B10 rests on: each token has its own Roles allowance, so a token's key must be exactly the spec's hash and two
/// tokens never share one.
contract Installer_Symbolic is Test {
    Installer internal installer;

    /// @dev Halmos needs Foundry's dynamic test linking off (`FOUNDRY_DYNAMIC_TEST_LINKING=false`): with it on,
    /// Foundry 1.8 compiles this `new` into `vm.deployCode`, which Halmos 0.3.3 does not support.
    function setUp() public {
        InstallerConfig memory config;
        installer = new Installer(config);
    }

    /// @dev B10: `payoutAllowanceKey(token) == keccak256("v4-payout-ceiling:" ++ token)` for every token, and the key
    /// is injective, so resizing one token's ceiling never writes another token's allowance.
    function check_B10_allowanceKeyPerToken(address a, address b) public view {
        // Vacuity guard (verification-loop.md): one concrete call must succeed, so the stub is a counterexample.
        try installer.payoutAllowanceKey(address(0xA11CE)) returns (bytes32 k) {
            assert(k == keccak256(abi.encodePacked("v4-payout-ceiling:", address(0xA11CE))));
        } catch {
            assert(false);
        }

        bytes32 ka = installer.payoutAllowanceKey(a);
        bytes32 kb = installer.payoutAllowanceKey(b);
        assert(ka == keccak256(abi.encodePacked("v4-payout-ceiling:", a)));
        assert((ka == kb) == (a == b));
    }

    /// @dev The payout role's key is the spec's constant (I1: Budgets is the member of exactly this role).
    function check_I1_payoutRoleKey() public view {
        try installer.PAYOUT_ROLE_KEY() returns (bytes32 k) {
            assert(k == keccak256("v4-payout"));
        } catch {
            assert(false);
        }
    }
}
