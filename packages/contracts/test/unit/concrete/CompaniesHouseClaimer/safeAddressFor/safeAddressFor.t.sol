// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { CompaniesHouseClaimer_Test } from "../../../../utils/CompaniesHouseClaimer/CompaniesHouseClaimer_Test.sol";

contract SafeAddressFor_CompaniesHouseClaimer_Unit_Concrete_Test is CompaniesHouseClaimer_Test {
    function test_WhenGivenTheProtocolPackagesConformanceVector() external view {
        // it should return the address safe-address.ts derives
        // `deriveCapxulSafeAddress({ email: "user@example.com", namespace: "capxul:devnet:email:v1" })`,
        // a Safe 1.5.0 namespace, pinned in safe-address-conformance.test.ts.
        assertEq(
            claimer.safeAddressFor(
                0x425FcA96f4A3e18fB80974e38096b5da460F2704, "capxul:devnet:email:v1", "user@example.com"
            ),
            0x22F9989369e1a39d9B02EAA1bF07509254B6136a
        );
    }

    function test_WhenGivenTheOwnerAndNamespaceAndEmailThatClaimUses() external {
        // it should return the Safe that claim deploys
        assertEq(_claim(NAMESPACE, EMAIL, signer), claimer.safeAddressFor(address(house), NAMESPACE, EMAIL));
    }
}
