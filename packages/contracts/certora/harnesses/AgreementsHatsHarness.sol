// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @notice A Hats Protocol stand-in in Agreements' scene, so H5 can show no Agreements call reaches a Hats
/// mutator (fv/certora.md "H5"). Every mutator sets `mutated`.
contract AgreementsHatsHarness {
    bool public mutated;

    function mintHat(uint256, address) external returns (bool) {
        mutated = true;
        return true;
    }

    function transferHat(uint256, address, address) external {
        mutated = true;
    }

    function changeHatEligibility(uint256, address) external {
        mutated = true;
    }

    function changeHatToggle(uint256, address) external {
        mutated = true;
    }

    function checkHatWearerStatus(uint256, address) external returns (bool) {
        mutated = true;
        return true;
    }
}
