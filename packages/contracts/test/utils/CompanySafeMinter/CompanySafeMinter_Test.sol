// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { CompanySafeMinter } from "../../../src/companies-house/CompanySafeMinter.sol";
import { Base_Test } from "../../Base.t.sol";
import { MockClaimProxyFactory, MockPersonalSafe } from "../CompaniesHouseClaimer/ClaimMocks.sol";

/// @dev Companies House reduced to what its company role does: delegatecall the minter, bubbling a revert.
contract MockMintingCompaniesHouse {
    function mintThrough(
        address minter,
        string calldata namespace,
        string calldata company,
        address founderSafe
    )
        external
        returns (address safe)
    {
        (bool ok, bytes memory result) = minter.delegatecall(
            abi.encodeWithSignature("mint(string,string,address)", namespace, company, founderSafe)
        );
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(result, 0x20), mload(result))
            }
        }
        safe = abi.decode(result, (address));
    }
}

/// @notice The hermetic minter fixture: a mock Companies House that delegatecalls the minter, a mock
/// factory etched at the canonical Safe proxy factory address, and a founder's Safe with code.
abstract contract CompanySafeMinter_Test is Base_Test {
    address internal constant SAFE_PROXY_FACTORY = 0x14F2982D601c9458F93bd70B218933A6f8165e7b;
    address internal constant SAFE_L2_SINGLETON = 0xEdd160fEBBD92E350D4D398fb636302fccd67C7e;
    address internal constant COMPATIBILITY_FALLBACK_HANDLER = 0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4;
    address internal constant SENTINEL_OWNERS = address(0x1);

    string internal constant NAMESPACE = "capxul:devnet:company:v1";
    string internal constant COMPANY = "org_amira_and_ben";

    CompanySafeMinter internal minter;
    MockMintingCompaniesHouse internal house;
    MockClaimProxyFactory internal factory;
    address internal founder;
    /// @dev The company Safe derived for `house`, NAMESPACE, COMPANY and `founder`.
    address internal derived;

    function setUp() public virtual override {
        super.setUp();
        minter = new CompanySafeMinter();
        house = new MockMintingCompaniesHouse();
        vm.etch(SAFE_PROXY_FACTORY, type(MockClaimProxyFactory).runtimeCode);
        factory = MockClaimProxyFactory(SAFE_PROXY_FACTORY);
        // The founder's personal Safe, already claimed by Amira.
        founder = makeAddr("Amira's personal Safe");
        vm.etch(founder, type(MockPersonalSafe).runtimeCode);
        MockPersonalSafe(founder).setUp(users.amira);
        derived = minter.companySafeAddressFor(address(house), NAMESPACE, COMPANY, founder);
        factory.setLanding(derived);
        vm.label(address(house), "Companies House");
        vm.label(derived, "derived company Safe");
    }

    function _mint(string memory namespace, string memory company, address founderSafe) internal returns (address) {
        return house.mintThrough(address(minter), namespace, company, founderSafe);
    }

    /// @dev Puts a company Safe owned by Companies House at the derived address, as if someone had
    /// already called the factory with the same initializer and salt.
    function _deployDerived() internal {
        vm.etch(derived, type(MockPersonalSafe).runtimeCode);
        MockPersonalSafe(derived).setUp(address(house));
    }

    /// @dev The Safe setup the minter must use, written out independently of the minter.
    function _expectedInitializer(address owner) internal pure returns (bytes memory) {
        address[] memory owners = new address[](1);
        owners[0] = owner;
        return abi.encodeWithSignature(
            "setup(address[],uint256,address,bytes,address,address,uint256,address)",
            owners,
            uint256(1),
            address(0),
            bytes(""),
            COMPATIBILITY_FALLBACK_HANDLER,
            address(0),
            uint256(0),
            address(0)
        );
    }
}
