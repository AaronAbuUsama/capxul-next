// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Captable } from "../../src/equity/Captable.sol";

/// @notice The Captable as the Prover sees it (fv/certora.md: a harness exposes, never changes behaviour).
/// Every read goes through the Captable's own external `getClass`, so the harness compiles against the stub
/// and the implementation alike.
contract CaptableHarness is Captable {
    function tokenOf(uint8 classId) external view returns (address) {
        return address(this.getClass(classId).token);
    }

    function authorisedOf(uint8 classId) external view returns (uint128) {
        return this.getClass(classId).authorised;
    }

    function weightOf(uint8 classId) external view returns (uint16) {
        return this.getClass(classId).weight;
    }

    function convertsIntoOf(uint8 classId) external view returns (uint8) {
        return this.getClass(classId).convertsInto;
    }

    function originalIssuePriceOf(uint8 classId) external view returns (uint128) {
        return this.getClass(classId).originalIssuePrice;
    }

    function floorOf(uint8 classId) external view returns (uint128) {
        return this.getClass(classId).conversionFloorPrice;
    }

    function classGovernorOf(uint8 classId) external view returns (address) {
        return this.getClass(classId).classGovernor;
    }

    function consentIdOf(
        uint8 classId,
        address from,
        address to,
        uint128 amount,
        bytes32 reason
    )
        external
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(classId, from, to, amount, reason));
    }
}
