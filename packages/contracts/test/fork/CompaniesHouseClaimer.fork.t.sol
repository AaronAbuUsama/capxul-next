// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { CompaniesHouseClaimer } from "../../src/companies-house/CompaniesHouseClaimer.sol";
import { Addresses } from "./Addresses.sol";
import { Fork_Test } from "./Fork_Test.t.sol";
import { IModuleProxyFactory, IRoles, IRolesScoping, ISafe, ISafeProxyFactory } from "./Interfaces.sol";

/// @dev Stands in for a claimer that writes one Companies House slot, to prove the storage check sees a write.
contract SlotWritingClaimer {
    mapping(uint256 => uint256) internal written;

    function claim(string calldata, string calldata, address) external returns (address) {
        written[1] = 1;
        return address(0);
    }
}

/// @notice Companies House on the real Safe v1.4.1 and Zodiac Roles v2.1.1 code on the pinned Base
/// Sepolia fork: a 2 of 3 Safe that is the bootstrap owner of every Capxul personal Safe, and one Roles
/// role per tier that may only delegatecall the claimer with that tier's salt namespace.
/// Carried across from beta `packages/contracts/test/fork/CompaniesHouse.fork.t.sol` (13 tests), plus CH9.
contract CompaniesHouseClaimer_Fork_Test is Fork_Test {
    address internal constant CAPXUL_BOOTSTRAP_OWNER = 0x425FcA96f4A3e18fB80974e38096b5da460F2704;

    uint8 internal constant STATIC = 1;
    uint8 internal constant DYNAMIC = 2;
    uint8 internal constant CALLDATA = 5;
    uint8 internal constant PASS = 0;
    uint8 internal constant MATCHES = 5;
    uint8 internal constant EQUAL_TO = 16;
    uint8 internal constant DELEGATE_CALL = 2;
    /// @dev Roles' Status.ParameterNotAllowed: an EqualTo condition did not match.
    uint8 internal constant PARAMETER_NOT_ALLOWED = 7;
    uint8 internal constant OPERATION_CALL = 0;
    uint8 internal constant OPERATION_DELEGATECALL = 1;

    bytes4 internal constant CONDITION_VIOLATION = bytes4(keccak256("ConditionViolation(uint8,bytes32)"));
    bytes4 internal constant MODULE_TRANSACTION_FAILED = bytes4(keccak256("ModuleTransactionFailed()"));

    uint256 internal constant GENESIS_SALT_NONCE = uint256(keccak256("capxul:companies-house:v1"));
    bytes32 internal constant CLAIMER_SALT = keccak256("capxul:companies-house-claimer:v1");
    bytes32 internal constant DEVNET_ROLE = "capxul.claim.devnet";
    bytes32 internal constant BETA_ROLE = "capxul.claim.beta";
    string internal constant DEVNET_NAMESPACE = "capxul:devnet:email:v1";
    string internal constant BETA_NAMESPACE = "capxul:beta:email:v1";

    uint256[3] internal ownerKeys;
    address[3] internal ownerAddresses;
    address internal service = makeAddr("devnet claim service");
    address internal betaService = makeAddr("beta claim service");
    address internal signer = makeAddr("person's signer");

    ISafe internal house;
    /// @dev Companies House's own Roles modifier (`roles` is Base_Test's company mock name, unset on the fork).
    IRoles internal houseRoles;
    CompaniesHouseClaimer internal claimer;

    function setUp() public override {
        super.setUp();
        (ownerAddresses[0], ownerKeys[0]) = makeAddrAndKey("aaron");
        (ownerAddresses[1], ownerKeys[1]) = makeAddrAndKey("rex");
        (ownerAddresses[2], ownerKeys[2]) = makeAddrAndKey("peter");

        address[] memory owners = new address[](3);
        for (uint256 index; index < 3; ++index) {
            owners[index] = ownerAddresses[index];
        }
        bytes memory initializer = abi.encodeCall(
            ISafe.setup,
            (
                owners,
                2,
                address(0),
                "",
                Addresses.COMPATIBILITY_FALLBACK_HANDLER_150,
                address(0),
                0,
                payable(address(0))
            )
        );
        house = ISafe(
            ISafeProxyFactory(Addresses.SAFE_PROXY_FACTORY_150)
                .createProxyWithNonce(Addresses.SAFE_L2_150, initializer, GENESIS_SALT_NONCE)
        );
        vm.label(address(house), "Companies House");

        claimer = new CompaniesHouseClaimer{ salt: CLAIMER_SALT }();
        houseRoles = IRoles(
            IModuleProxyFactory(Addresses.MODULE_PROXY_FACTORY)
                .deployModule(
                    Addresses.ROLES_V2_MASTERCOPY,
                    abi.encodeCall(IRoles.setUp, (abi.encode(address(house), address(house), address(house)))),
                    0
                )
        );
        vm.label(address(houseRoles), "Companies House Roles");

        _ownersExec(address(house), abi.encodeCall(ISafe.enableModule, (address(houseRoles))));
        _scopeTier(DEVNET_ROLE, DEVNET_NAMESPACE);
        _scopeTier(BETA_ROLE, BETA_NAMESPACE);
        _assign(service, DEVNET_ROLE, true);
        _assign(betaService, BETA_ROLE, true);
    }

    /// @dev Beta CompaniesHouse.fork.t.sol:110 (CH2).
    function test_claimDeploysTheSafeAndMakesTheSignerItsSoleOwner() public {
        address expected = claimer.safeAddressFor(address(house), DEVNET_NAMESPACE, "alice@example.com");
        assertEq(expected.code.length, 0, "Safe not deployed before the claim");

        _claimAs(service, DEVNET_ROLE, DEVNET_NAMESPACE, "alice@example.com", signer);

        assertGt(expected.code.length, 0, "Safe deployed at the derived address");
        address[] memory owners = ISafe(expected).getOwners();
        assertEq(owners.length, 1);
        assertEq(owners[0], signer, "signer is the sole owner");
        assertEq(ISafe(expected).getThreshold(), 1);
    }

    /// @dev Beta CompaniesHouse.fork.t.sol:123 (CH3).
    function test_claimSwapsAnAlreadyDeployedSafe() public {
        // Anyone may deploy a counterfactual Safe; the claim then only swaps.
        address expected = claimer.safeAddressFor(address(house), DEVNET_NAMESPACE, "bob@example.com");
        vm.prank(makeAddr("stranger"));
        ISafeProxyFactory(Addresses.SAFE_PROXY_FACTORY_150)
            .createProxyWithNonce(
                Addresses.SAFE_L2_150,
                _personalInitializer(address(house)),
                _saltNonce(DEVNET_NAMESPACE, "bob@example.com")
            );
        assertGt(expected.code.length, 0);
        assertEq(ISafe(expected).getOwners()[0], address(house), "Companies House owns it before the claim");

        _claimAs(service, DEVNET_ROLE, DEVNET_NAMESPACE, "bob@example.com", signer);

        assertEq(ISafe(expected).getOwners()[0], signer);
    }

    /// @dev Beta CompaniesHouse.fork.t.sol:139 (CH5).
    function test_aTierRoleCannotClaimAnotherTiersSafe() public {
        vm.prank(service);
        vm.expectRevert(abi.encodeWithSelector(CONDITION_VIOLATION, PARAMETER_NOT_ALLOWED, bytes32(0)));
        houseRoles.execTransactionWithRole(
            address(claimer),
            0,
            abi.encodeCall(CompaniesHouseClaimer.claim, (BETA_NAMESPACE, "alice@example.com", signer)),
            OPERATION_DELEGATECALL,
            DEVNET_ROLE,
            true
        );
    }

    /// @dev Beta CompaniesHouse.fork.t.sol:152 (CH5).
    function test_aServiceCannotUseItsRoleForAnyOtherCall() public {
        vm.prank(service);
        vm.expectRevert();
        houseRoles.execTransactionWithRole(
            address(house), 0, abi.encodeCall(ISafe.enableModule, (service)), OPERATION_CALL, DEVNET_ROLE, true
        );
    }

    /// @dev Beta CompaniesHouse.fork.t.sol:160 (CH5).
    function test_aNonMemberCannotClaim() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        houseRoles.execTransactionWithRole(
            address(claimer),
            0,
            abi.encodeCall(CompaniesHouseClaimer.claim, (DEVNET_NAMESPACE, "alice@example.com", signer)),
            OPERATION_DELEGATECALL,
            DEVNET_ROLE,
            true
        );
    }

    /// @dev Beta CompaniesHouse.fork.t.sol:173 (CH4).
    function test_aClaimedSafeCannotBeClaimedAgain() public {
        _claimAs(service, DEVNET_ROLE, DEVNET_NAMESPACE, "alice@example.com", signer);

        vm.prank(service);
        vm.expectRevert(MODULE_TRANSACTION_FAILED);
        houseRoles.execTransactionWithRole(
            address(claimer),
            0,
            abi.encodeCall(CompaniesHouseClaimer.claim, (DEVNET_NAMESPACE, "alice@example.com", makeAddr("thief"))),
            OPERATION_DELEGATECALL,
            DEVNET_ROLE,
            true
        );
    }

    /// @dev Beta CompaniesHouse.fork.t.sol:188 (CH1).
    function test_aPlainCallToTheClaimerIsRefused() public {
        vm.expectRevert(CompaniesHouseClaimer.NotDelegateCall.selector);
        claimer.claim(DEVNET_NAMESPACE, "alice@example.com", signer);

        // Through the role as a plain call too: the claimer runs as itself.
        vm.prank(service);
        vm.expectRevert(MODULE_TRANSACTION_FAILED);
        houseRoles.execTransactionWithRole(
            address(claimer),
            0,
            abi.encodeCall(CompaniesHouseClaimer.claim, (DEVNET_NAMESPACE, "alice@example.com", signer)),
            OPERATION_CALL,
            DEVNET_ROLE,
            true
        );
    }

    /// @dev Beta CompaniesHouse.fork.t.sol:205 (CH6).
    function test_anEmailThatIsNotNormalizedIsRefused() public {
        vm.prank(service);
        vm.expectRevert(MODULE_TRANSACTION_FAILED);
        houseRoles.execTransactionWithRole(
            address(claimer),
            0,
            abi.encodeCall(CompaniesHouseClaimer.claim, (DEVNET_NAMESPACE, "Alice@Example.com", signer)),
            OPERATION_DELEGATECALL,
            DEVNET_ROLE,
            true
        );
    }

    /// @dev Beta CompaniesHouse.fork.t.sol:218 (CH6).
    function test_anEmailThatIsNotAsciiIsRefused() public {
        vm.prank(service);
        vm.expectRevert(MODULE_TRANSACTION_FAILED);
        houseRoles.execTransactionWithRole(
            address(claimer),
            0,
            abi.encodeCall(CompaniesHouseClaimer.claim, (DEVNET_NAMESPACE, unicode"ä@example.com", signer)),
            OPERATION_DELEGATECALL,
            DEVNET_ROLE,
            true
        );
    }

    /// @dev Beta CompaniesHouse.fork.t.sol:231 (CH6).
    /// Asserts the claimer's own `InvalidSigner`: without that check the Safe's swap still fails
    /// (GS013 from the Safe itself), so a bare revert would pass with the check deleted.
    function test_companiesHouseCannotBeMadeTheSigner() public {
        vm.prank(service);
        vm.expectRevert(MODULE_TRANSACTION_FAILED);
        houseRoles.execTransactionWithRole(
            address(claimer),
            0,
            abi.encodeCall(CompaniesHouseClaimer.claim, (DEVNET_NAMESPACE, "alice@example.com", address(house))),
            OPERATION_DELEGATECALL,
            DEVNET_ROLE,
            true
        );

        vm.prank(service);
        (bool success, bytes memory returnData) = houseRoles.execTransactionWithRoleReturnData(
            address(claimer),
            0,
            abi.encodeCall(CompaniesHouseClaimer.claim, (DEVNET_NAMESPACE, "alice@example.com", address(house))),
            OPERATION_DELEGATECALL,
            DEVNET_ROLE,
            false
        );
        assertFalse(success, "the claim went through");
        assertEq(returnData, abi.encodeWithSelector(CompaniesHouseClaimer.InvalidSigner.selector), "not InvalidSigner");
        assertEq(
            claimer.safeAddressFor(address(house), DEVNET_NAMESPACE, "alice@example.com").code.length,
            0,
            "nothing deployed"
        );
    }

    /// @dev Beta CompaniesHouse.fork.t.sol:244 (CH7).
    function test_rotatingTheServiceKeyMovesNoAddress() public {
        address before = claimer.safeAddressFor(address(house), DEVNET_NAMESPACE, "carol@example.com");
        address replacement = makeAddr("replacement service");

        _assign(service, DEVNET_ROLE, false);
        _assign(replacement, DEVNET_ROLE, true);

        vm.prank(service);
        vm.expectRevert();
        houseRoles.execTransactionWithRole(
            address(claimer),
            0,
            abi.encodeCall(CompaniesHouseClaimer.claim, (DEVNET_NAMESPACE, "carol@example.com", signer)),
            OPERATION_DELEGATECALL,
            DEVNET_ROLE,
            true
        );

        _claimAs(replacement, DEVNET_ROLE, DEVNET_NAMESPACE, "carol@example.com", signer);
        assertEq(claimer.safeAddressFor(address(house), DEVNET_NAMESPACE, "carol@example.com"), before);
        assertEq(ISafe(before).getOwners()[0], signer);
    }

    /// @dev Beta CompaniesHouse.fork.t.sol:267 (CH10).
    function test_oneOwnerAloneCannotChangeCompaniesHouse() public {
        bytes memory data = abi.encodeCall(ISafe.enableModule, (makeAddr("rogue module")));
        bytes32 hash =
            house.getTransactionHash(address(house), 0, data, 0, 0, 0, 0, address(0), address(0), house.nonce());
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKeys[0], hash);
        vm.expectRevert(bytes("GS020"));
        house.execTransaction(
            address(house), 0, data, 0, 0, 0, 0, address(0), payable(address(0)), abi.encodePacked(r, s, v)
        );
    }

    /// @dev Beta CompaniesHouse.fork.t.sol:278 (CH8).
    function test_derivationMatchesTheProtocolPackage() public view {
        // `deriveCapxulSafeAddress({ email: "user@example.com" })` with the devnet
        // namespace (Safe 1.5.0), pinned in safe-address-conformance.test.ts.
        assertEq(
            claimer.safeAddressFor(CAPXUL_BOOTSTRAP_OWNER, "capxul:devnet:email:v1", "user@example.com"),
            0x22F9989369e1a39d9B02EAA1bF07509254B6136a
        );
    }

    /// @dev New (CH9): the delegatecalled claim leaves every Companies House slot as it was.
    function test_aClaimWritesNoCompaniesHouseStorage() public {
        assertEq(_houseWritesDuringClaim("dana@example.com"), 0, "a claim wrote Companies House storage");
        assertEq(
            ISafe(claimer.safeAddressFor(address(house), DEVNET_NAMESPACE, "dana@example.com")).getOwners()[0],
            signer,
            "the claim ran"
        );
    }

    /// @dev CH9 is not vacuous: the same check counts the one slot a writing claimer sets.
    function test_theStorageCheckSeesAWrite() public {
        vm.etch(address(claimer), type(SlotWritingClaimer).runtimeCode);
        assertEq(_houseWritesDuringClaim("dana@example.com"), 1, "the check missed a write");
    }

    /// @dev Records storage access across one claim and returns the slots written on Companies House.
    function _houseWritesDuringClaim(string memory email) internal returns (uint256) {
        vm.record();
        _claimAs(service, DEVNET_ROLE, DEVNET_NAMESPACE, email, signer);
        (, bytes32[] memory writes) = vm.accesses(address(house));
        return writes.length;
    }

    function _scopeTier(bytes32 roleKey, string memory namespace) internal {
        IRolesScoping.ConditionFlat[] memory conditions = new IRolesScoping.ConditionFlat[](4);
        conditions[0] =
            IRolesScoping.ConditionFlat({ parent: 0, paramType: CALLDATA, operator: MATCHES, compValue: "" });
        // Roles 2.1.1 compares a dynamic parameter against its full ABI encoding.
        conditions[1] = IRolesScoping.ConditionFlat({
            parent: 0, paramType: DYNAMIC, operator: EQUAL_TO, compValue: abi.encode(namespace)
        });
        conditions[2] = IRolesScoping.ConditionFlat({ parent: 0, paramType: DYNAMIC, operator: PASS, compValue: "" });
        conditions[3] = IRolesScoping.ConditionFlat({ parent: 0, paramType: STATIC, operator: PASS, compValue: "" });
        _ownersExec(address(houseRoles), abi.encodeCall(IRoles.scopeTarget, (roleKey, address(claimer))));
        _ownersExec(
            address(houseRoles),
            abi.encodeCall(
                IRolesScoping.scopeFunction,
                (roleKey, address(claimer), CompaniesHouseClaimer.claim.selector, conditions, DELEGATE_CALL)
            )
        );
    }

    function _assign(address member, bytes32 roleKey, bool memberOf) internal {
        bytes32[] memory keys = new bytes32[](1);
        keys[0] = roleKey;
        bool[] memory flags = new bool[](1);
        flags[0] = memberOf;
        _ownersExec(address(houseRoles), abi.encodeCall(IRoles.assignRoles, (member, keys, flags)));
    }

    function _claimAs(
        address member,
        bytes32 roleKey,
        string memory namespace,
        string memory email,
        address newOwner
    )
        internal
    {
        vm.prank(member);
        houseRoles.execTransactionWithRole(
            address(claimer),
            0,
            abi.encodeCall(CompaniesHouseClaimer.claim, (namespace, email, newOwner)),
            OPERATION_DELEGATECALL,
            roleKey,
            true
        );
    }

    /// @dev Aaron and Rex sign (2 of 3), in ascending owner order as Safe requires.
    function _ownersExec(address to, bytes memory data) internal {
        bytes32 hash = house.getTransactionHash(to, 0, data, 0, 0, 0, 0, address(0), address(0), house.nonce());
        bytes memory signatures = _twoSignatures(hash);
        assertTrue(house.execTransaction(to, 0, data, 0, 0, 0, 0, address(0), payable(address(0)), signatures));
    }

    function _twoSignatures(bytes32 hash) internal view returns (bytes memory) {
        (uint256 firstKey, uint256 secondKey) =
            ownerAddresses[0] < ownerAddresses[1] ? (ownerKeys[0], ownerKeys[1]) : (ownerKeys[1], ownerKeys[0]);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(firstKey, hash);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(secondKey, hash);
        return abi.encodePacked(r1, s1, v1, r2, s2, v2);
    }

    function _personalInitializer(address owner) internal pure returns (bytes memory) {
        address[] memory modules = new address[](1);
        modules[0] = 0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226;
        bytes memory enableModules = abi.encodeWithSignature("enableModules(address[])", modules);
        bytes memory payload = abi.encodePacked(
            uint8(1),
            address(0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47),
            uint256(0),
            enableModules.length,
            enableModules
        );
        address[] memory owners = new address[](1);
        owners[0] = owner;
        return abi.encodeCall(
            ISafe.setup,
            (
                owners,
                1,
                Addresses.MULTI_SEND_141,
                abi.encodeWithSignature("multiSend(bytes)", payload),
                0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226,
                address(0),
                0,
                payable(address(0))
            )
        );
    }

    function _saltNonce(string memory namespace, string memory email) internal pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(namespace, ":", email)));
    }
}
