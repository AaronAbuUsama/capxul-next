// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { CompanySafeMinter_Test } from "../../../../utils/CompanySafeMinter/CompanySafeMinter_Test.sol";

contract CompanySafeAddressFor_CompanySafeMinter_Unit_Concrete_Test is CompanySafeMinter_Test {
    function test_WhenGivenTheProtocolPackagesConformanceVector() external view {
        // it should return the address companies-house.ts derives
        // `deriveCompaniesHouseCompanySafeAddress` for the stand-in devnet Companies House, pinned in
        // packages/protocol/src/evm/tests/companies-house.test.ts.
        assertEq(
            minter.companySafeAddressFor(
                0x38d9772b87a52Ed4615E2c804414f0cDD4854F2F,
                "capxul:devnet:company:v1",
                "org_amira_and_ben",
                0x000000000000000000000000000000000000F00D
            ),
            0x4a3348dBFa10AFb8e4235D12a2B880b026BadC2B
        );
    }

    function test_WhenGivenTheOwnerAndNamespaceAndCompanyAndFounderThatMintUses() external {
        // it should return the Safe that mint deploys
        assertEq(
            _mint(NAMESPACE, COMPANY, founder),
            minter.companySafeAddressFor(address(house), NAMESPACE, COMPANY, founder)
        );
    }

    function test_WhenTheFoundersSafeDiffers() external {
        // it should return another address
        assertNotEq(
            minter.companySafeAddressFor(address(house), NAMESPACE, COMPANY, makeAddr("another founder's Safe")),
            derived
        );
    }
}
