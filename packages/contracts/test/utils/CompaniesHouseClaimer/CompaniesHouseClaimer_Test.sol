// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { CompaniesHouseClaimer } from "../../../src/companies-house/CompaniesHouseClaimer.sol";
import { Base_Test } from "../../Base.t.sol";
import { MockClaimProxyFactory, MockCompaniesHouse, MockPersonalSafe } from "./ClaimMocks.sol";

/// @notice The hermetic claimer fixture (ruling J3): a mock Companies House that delegatecalls the
/// claimer, and a mock factory etched at the canonical Safe proxy factory address.
abstract contract CompaniesHouseClaimer_Test is Base_Test {
    address internal constant SAFE_PROXY_FACTORY = 0x14F2982D601c9458F93bd70B218933A6f8165e7b;
    address internal constant SAFE_L2_SINGLETON = 0xEdd160fEBBD92E350D4D398fb636302fccd67C7e;
    address internal constant SAFE_MODULE_SETUP = 0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47;
    address internal constant SAFE_4337_MODULE = 0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226;
    address internal constant MULTI_SEND = 0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526;
    address internal constant SENTINEL_OWNERS = address(0x1);

    string internal constant NAMESPACE = "capxul:devnet:email:v1";
    string internal constant EMAIL = "alice@example.com";

    CompaniesHouseClaimer internal claimer;
    MockCompaniesHouse internal house;
    MockClaimProxyFactory internal factory;
    address internal signer;
    /// @dev The Safe derived for `house`, NAMESPACE and EMAIL.
    address internal derived;

    function setUp() public virtual override {
        super.setUp();
        claimer = new CompaniesHouseClaimer();
        house = new MockCompaniesHouse();
        vm.etch(SAFE_PROXY_FACTORY, type(MockClaimProxyFactory).runtimeCode);
        factory = MockClaimProxyFactory(SAFE_PROXY_FACTORY);
        signer = users.alice;
        derived = claimer.safeAddressFor(address(house), NAMESPACE, EMAIL);
        factory.setLanding(derived);
        vm.label(address(house), "Companies House");
        vm.label(derived, "derived personal Safe");
    }

    function _claim(string memory namespace, string memory email, address to) internal returns (address) {
        return house.claimThrough(address(claimer), namespace, email, to);
    }

    /// @dev Puts a personal Safe owned by Companies House at the derived address, as if someone had
    /// already called the factory with the same initializer and salt.
    function _deployDerived() internal {
        vm.etch(derived, type(MockPersonalSafe).runtimeCode);
        MockPersonalSafe(derived).setUp(address(house));
    }

    /// @dev The Safe setup the claimer must use, written out independently of the claimer.
    function _expectedInitializer(address owner) internal pure returns (bytes memory) {
        address[] memory modules = new address[](1);
        modules[0] = SAFE_4337_MODULE;
        bytes memory enableModules = abi.encodeWithSignature("enableModules(address[])", modules);
        bytes memory payload =
            abi.encodePacked(uint8(1), SAFE_MODULE_SETUP, uint256(0), enableModules.length, enableModules);
        address[] memory owners = new address[](1);
        owners[0] = owner;
        return abi.encodeWithSignature(
            "setup(address[],uint256,address,bytes,address,address,uint256,address)",
            owners,
            uint256(1),
            MULTI_SEND,
            abi.encodeWithSignature("multiSend(bytes)", payload),
            SAFE_4337_MODULE,
            address(0),
            uint256(0),
            address(0)
        );
    }
}
