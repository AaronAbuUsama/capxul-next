// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @notice Third-party contracts on Base Sepolia (chain 84532) at the fork pin. Every address has code
/// at block 47,893,251 (`cast codesize`), as checked in docs/planning/protocol-v4/research/R5-test-harness.md
/// section 2 and R3-hats-stack.md section 1. Explorer: https://sepolia.basescan.org/address/<address>.
library Addresses {
    /// @dev The one place the fork pin lives (R5 section 2).
    uint256 internal constant FORK_BLOCK = 47_893_251;
    uint256 internal constant CHAIN_ID = 84_532;

    // Safe 1.4.1 libraries (R3 section 1, R5 section 2). They hold no state and work with any Safe version, so
    // Hats Signer Gate's delegatecall targets and Roles' MultiSend unwrapper keep these addresses.
    address internal constant MULTI_SEND_CALL_ONLY_141 = 0x9641d764fc13c8B624c04430C7356C1C7C8102e2;
    address internal constant MULTI_SEND_141 = 0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526;
    /// @dev Code present; source not opened (R5 section 2, UNCONFIRMED).
    address internal constant CREATE_CALL_141 = 0x9b35Af71d77eaf8d7e40252370304687390A1A52;

    // Safe 1.5.0 (safe-global/safe-deployments src/assets/v1.5.0, canonical; code checked with eth_getCode on
    // Base Sepolia and Arbitrum One, 2026-11-02). Every Capxul Safe is created on these.
    address internal constant SAFE_L2_150 = 0xEdd160fEBBD92E350D4D398fb636302fccd67C7e;
    address internal constant SAFE_PROXY_FACTORY_150 = 0x14F2982D601c9458F93bd70B218933A6f8165e7b;
    address internal constant COMPATIBILITY_FALLBACK_HANDLER_150 = 0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4;

    // Zodiac (R5 section 2).
    address internal constant ROLES_V2_MASTERCOPY = 0xF2964CE6161ce0e75964Fe7927cE114cb0B283D5;
    /// @dev Runtime code hash of the Roles 2.1 mastercopy, as packages/contracts/test/fork/PayrollDepartmentsForkBase.sol.
    bytes32 internal constant ROLES_V2_CODEHASH = 0x471d8b3b419f1eb955230c0326c8812176df49bf3c7b414a563fda5a3c6c10b6;
    address internal constant ROLES_MULTISEND_UNWRAPPER = 0xB4Cd4bb764C089f20DA18700CE8bc5e49F369efD;
    /// @dev Deploys Roles and HSG v2 instances (HSG v2 has no factory of its own, R3 section 1).
    address internal constant MODULE_PROXY_FACTORY = 0x000000000000aDdB49795b0f9bA5BC298cDda236;

    // Hats (R3 section 1).
    address internal constant HATS = 0x3bc1A0Ad72417f2d411118085256fC53CBdDd137;
    /// @dev v0.7.0; deploys Hats Elections instances. Do not use v0.6.0 at 0xfE66…9efA.
    address internal constant HATS_MODULE_FACTORY = 0x0a3f85fa597B6a967271286aA0724811acDF5CD9;
    /// @dev v2.0.0, compiled for Cancun.
    address internal constant HATS_SIGNER_GATE_V2 = 0x148057884AC910Bdd93693F230C5c35a8c47CA3b;
    /// @dev v0.2.0 (pre-release). The release page does not list Base Sepolia, but the same verified
    /// CREATE2 deployment is there (R3 section 1).
    address internal constant HATS_ELECTION_ELIGIBILITY = 0xd3b916a8F0C4f9D1d5B6Af29c3C012dbd4f3149E;
}
