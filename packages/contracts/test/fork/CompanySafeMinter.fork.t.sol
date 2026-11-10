// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { CompaniesHouseClaimer } from "../../src/companies-house/CompaniesHouseClaimer.sol";
import { CompanySafeMinter } from "../../src/companies-house/CompanySafeMinter.sol";
import { Addresses } from "./Addresses.sol";
import { Fork_Test } from "./Fork_Test.t.sol";
import { IModuleProxyFactory, IRoles, IRolesScoping, ISafe, ISafeProxyFactory } from "./Interfaces.sol";

/// @dev Stands in for a minter that writes one Companies House slot, to prove the storage check sees a write.
contract SlotWritingMinter {
    mapping(uint256 => uint256) internal written;

    function mint(string calldata, string calldata, address) external returns (address) {
        written[1] = 1;
        return address(0);
    }
}

/// @notice Companies House mints company Safes on the real Safe v1.4.1 and Zodiac Roles v2.1.1 code on
/// the pinned Base Sepolia fork: one Roles role per tier may only delegatecall the minter with that
/// tier's company namespace, beside the tier's claim role for personal Safes (CAP-1093).
contract CompanySafeMinter_Fork_Test is Fork_Test {
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
    /// @dev keccak256("fallback_manager.handler.address"), Safe 1.4.1's fallback handler slot.
    bytes32 internal constant FALLBACK_HANDLER_SLOT =
        0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5;

    bytes4 internal constant CONDITION_VIOLATION = bytes4(keccak256("ConditionViolation(uint8,bytes32)"));
    bytes4 internal constant MODULE_TRANSACTION_FAILED = bytes4(keccak256("ModuleTransactionFailed()"));

    uint256 internal constant GENESIS_SALT_NONCE = uint256(keccak256("capxul:companies-house:v1"));
    bytes32 internal constant DEVNET_CLAIM_ROLE = "capxul.claim.devnet";
    bytes32 internal constant DEVNET_COMPANY_ROLE = "capxul.company.devnet";
    bytes32 internal constant BETA_COMPANY_ROLE = "capxul.company.beta";
    string internal constant DEVNET_EMAIL_NAMESPACE = "capxul:devnet:email:v1";
    string internal constant DEVNET_COMPANY_NAMESPACE = "capxul:devnet:company:v1";
    string internal constant BETA_COMPANY_NAMESPACE = "capxul:beta:company:v1";
    string internal constant COMPANY = "org_amira_and_ben";

    uint256[3] internal ownerKeys;
    address[3] internal ownerAddresses;
    address internal service = makeAddr("devnet service");
    address internal betaService = makeAddr("beta service");
    address internal signer = makeAddr("person's signer");

    ISafe internal house;
    IRoles internal houseRoles;
    CompaniesHouseClaimer internal claimer;
    CompanySafeMinter internal minter;

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

        claimer = new CompaniesHouseClaimer();
        minter = new CompanySafeMinter();
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
        _scope(DEVNET_CLAIM_ROLE, address(claimer), CompaniesHouseClaimer.claim.selector, DEVNET_EMAIL_NAMESPACE);
        _scope(DEVNET_COMPANY_ROLE, address(minter), CompanySafeMinter.mint.selector, DEVNET_COMPANY_NAMESPACE);
        _scope(BETA_COMPANY_ROLE, address(minter), CompanySafeMinter.mint.selector, BETA_COMPANY_NAMESPACE);
        _assign(service, DEVNET_CLAIM_ROLE, true);
        _assign(service, DEVNET_COMPANY_ROLE, true);
        _assign(betaService, BETA_COMPANY_ROLE, true);
    }

    /// @dev A person claims their personal Safe, then Companies House mints their company's Safe,
    /// owned by that personal Safe alone, with no module and the Safe 1.4.1 fallback handler.
    function test_mintDeploysTheCompanySafeOwnedByTheFoundersSafe() public {
        address personal = _claimAs(service, "amira@example.com", signer);
        address expected = minter.companySafeAddressFor(address(house), DEVNET_COMPANY_NAMESPACE, COMPANY, personal);
        assertEq(expected.code.length, 0, "company Safe not deployed before the mint");

        address minted = _mintAs(service, DEVNET_COMPANY_ROLE, DEVNET_COMPANY_NAMESPACE, COMPANY, personal);

        assertEq(minted, expected, "the role returns the derived company Safe");
        assertGt(expected.code.length, 0, "company Safe deployed at the derived address");
        address[] memory owners = ISafe(expected).getOwners();
        assertEq(owners.length, 1, "one owner");
        assertEq(owners[0], personal, "the founder's personal Safe is the sole owner");
        assertEq(ISafe(expected).getThreshold(), 1, "threshold 1");
        (address[] memory modules,) = ISafe(expected).getModulesPaginated(SENTINEL, 10);
        assertEq(modules.length, 0, "no module, so no 4337 module");
        assertEq(
            address(uint160(uint256(vm.load(expected, FALLBACK_HANDLER_SLOT)))),
            Addresses.COMPATIBILITY_FALLBACK_HANDLER_150,
            "Safe 1.4.1 fallback handler"
        );
        assertFalse(ISafe(expected).isOwner(address(house)), "Companies House is gone");
    }

    /// @dev The founder's personal Safe then runs the company Safe alone: a v = 1 signature from it passes.
    function test_theFoundersSafeRunsTheMintedCompanySafe() public {
        address personal = _claimAs(service, "amira@example.com", signer);
        ISafe company = ISafe(_mintAs(service, DEVNET_COMPANY_ROLE, DEVNET_COMPANY_NAMESPACE, COMPANY, personal));
        vm.deal(address(company), 1 ether);
        address payee = makeAddr("payee");
        bytes memory approved = abi.encodePacked(uint256(uint160(personal)), bytes32(0), uint8(1));

        vm.prank(personal);
        assertTrue(
            company.execTransaction(payee, 0.25 ether, "", 0, 0, 0, 0, address(0), payable(address(0)), approved)
        );
        assertEq(payee.balance, 0.25 ether, "the company Safe paid");

        // Companies House can no longer act for it.
        bytes memory houseSignature = abi.encodePacked(uint256(uint160(address(house))), bytes32(0), uint8(1));
        vm.prank(address(house));
        vm.expectRevert(bytes("GS026"));
        company.execTransaction(payee, 0.25 ether, "", 0, 0, 0, 0, address(0), payable(address(0)), houseSignature);
    }

    /// @dev Anyone may deploy the counterfactual company Safe first; it is Companies House's, and the mint swaps it.
    function test_mintSwapsACompanySafeAStrangerDeployed() public {
        address expected =
            minter.companySafeAddressFor(address(house), DEVNET_COMPANY_NAMESPACE, COMPANY, address(founderSafe));
        address[] memory owners = new address[](1);
        owners[0] = address(house);
        vm.prank(makeAddr("stranger"));
        ISafeProxyFactory(Addresses.SAFE_PROXY_FACTORY_150)
            .createProxyWithNonce(
                Addresses.SAFE_L2_150,
                abi.encodeCall(
                    ISafe.setup,
                    (
                        owners,
                        1,
                        address(0),
                        "",
                        Addresses.COMPATIBILITY_FALLBACK_HANDLER_150,
                        address(0),
                        0,
                        payable(address(0))
                    )
                ),
                uint256(keccak256(abi.encode(DEVNET_COMPANY_NAMESPACE, COMPANY, address(founderSafe))))
            );
        assertEq(ISafe(expected).getOwners()[0], address(house), "Companies House owns it before the mint");

        _mintAs(service, DEVNET_COMPANY_ROLE, DEVNET_COMPANY_NAMESPACE, COMPANY, address(founderSafe));

        assertEq(ISafe(expected).getOwners()[0], address(founderSafe));
    }

    function test_aTierRoleCannotMintAnotherTiersCompanySafe() public {
        vm.prank(service);
        vm.expectRevert(abi.encodeWithSelector(CONDITION_VIOLATION, PARAMETER_NOT_ALLOWED, bytes32(0)));
        houseRoles.execTransactionWithRole(
            address(minter),
            0,
            abi.encodeCall(CompanySafeMinter.mint, (BETA_COMPANY_NAMESPACE, COMPANY, address(founderSafe))),
            OPERATION_DELEGATECALL,
            DEVNET_COMPANY_ROLE,
            true
        );
    }

    /// @dev The company role reaches only the minter, and the claim role only the claimer.
    function test_eachRoleReachesOnlyItsOwnContract() public {
        vm.prank(service);
        vm.expectRevert();
        houseRoles.execTransactionWithRole(
            address(claimer),
            0,
            abi.encodeCall(CompaniesHouseClaimer.claim, (DEVNET_EMAIL_NAMESPACE, "amira@example.com", signer)),
            OPERATION_DELEGATECALL,
            DEVNET_COMPANY_ROLE,
            true
        );

        vm.prank(service);
        vm.expectRevert();
        houseRoles.execTransactionWithRole(
            address(minter),
            0,
            abi.encodeCall(CompanySafeMinter.mint, (DEVNET_COMPANY_NAMESPACE, COMPANY, address(founderSafe))),
            OPERATION_DELEGATECALL,
            DEVNET_CLAIM_ROLE,
            true
        );

        vm.prank(service);
        vm.expectRevert();
        houseRoles.execTransactionWithRole(
            address(house), 0, abi.encodeCall(ISafe.enableModule, (service)), OPERATION_CALL, DEVNET_COMPANY_ROLE, true
        );
    }

    function test_aNonMemberCannotMint() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        houseRoles.execTransactionWithRole(
            address(minter),
            0,
            abi.encodeCall(CompanySafeMinter.mint, (DEVNET_COMPANY_NAMESPACE, COMPANY, address(founderSafe))),
            OPERATION_DELEGATECALL,
            DEVNET_COMPANY_ROLE,
            true
        );
    }

    function test_aMintedCompanySafeCannotBeMintedAgain() public {
        _mintAs(service, DEVNET_COMPANY_ROLE, DEVNET_COMPANY_NAMESPACE, COMPANY, address(founderSafe));

        vm.prank(service);
        vm.expectRevert(MODULE_TRANSACTION_FAILED);
        houseRoles.execTransactionWithRole(
            address(minter),
            0,
            abi.encodeCall(CompanySafeMinter.mint, (DEVNET_COMPANY_NAMESPACE, COMPANY, address(founderSafe))),
            OPERATION_DELEGATECALL,
            DEVNET_COMPANY_ROLE,
            true
        );
    }

    function test_aPlainCallToTheMinterIsRefused() public {
        vm.expectRevert(CompanySafeMinter.NotDelegateCall.selector);
        minter.mint(DEVNET_COMPANY_NAMESPACE, COMPANY, address(founderSafe));

        // Through the role as a plain call too: the minter runs as itself.
        vm.prank(service);
        vm.expectRevert(MODULE_TRANSACTION_FAILED);
        houseRoles.execTransactionWithRole(
            address(minter),
            0,
            abi.encodeCall(CompanySafeMinter.mint, (DEVNET_COMPANY_NAMESPACE, COMPANY, address(founderSafe))),
            OPERATION_CALL,
            DEVNET_COMPANY_ROLE,
            true
        );
    }

    /// @dev A founder that is not a deployed Safe is refused with the minter's own error.
    function test_aFounderWithNoCodeIsRefused() public {
        vm.prank(service);
        (bool success, bytes memory returnData) = houseRoles.execTransactionWithRoleReturnData(
            address(minter),
            0,
            abi.encodeCall(CompanySafeMinter.mint, (DEVNET_COMPANY_NAMESPACE, COMPANY, makeAddr("no Safe"))),
            OPERATION_DELEGATECALL,
            DEVNET_COMPANY_ROLE,
            false
        );
        assertFalse(success, "the mint went through");
        assertEq(returnData, abi.encodeWithSelector(CompanySafeMinter.InvalidFounderSafe.selector));
    }

    function test_aMintWritesNoCompaniesHouseStorage() public {
        assertEq(_houseWritesDuringMint(), 0, "a mint wrote Companies House storage");
        assertEq(
            ISafe(minter.companySafeAddressFor(address(house), DEVNET_COMPANY_NAMESPACE, COMPANY, address(founderSafe)))
                .getOwners()[0],
            address(founderSafe),
            "the mint ran"
        );
    }

    /// @dev The storage check is not vacuous: it counts the one slot a writing minter sets.
    function test_theStorageCheckSeesAWrite() public {
        vm.etch(address(minter), type(SlotWritingMinter).runtimeCode);
        assertEq(_houseWritesDuringMint(), 1, "the check missed a write");
    }

    function _houseWritesDuringMint() internal returns (uint256) {
        vm.record();
        _mintAs(service, DEVNET_COMPANY_ROLE, DEVNET_COMPANY_NAMESPACE, COMPANY, address(founderSafe));
        (, bytes32[] memory writes) = vm.accesses(address(house));
        return writes.length;
    }

    /// @dev Scope a role to delegatecall one function whose first parameter is the pinned namespace,
    /// with any string and any address after it.
    function _scope(bytes32 roleKey, address target, bytes4 selector, string memory namespace) internal {
        IRolesScoping.ConditionFlat[] memory conditions = new IRolesScoping.ConditionFlat[](4);
        conditions[0] =
            IRolesScoping.ConditionFlat({ parent: 0, paramType: CALLDATA, operator: MATCHES, compValue: "" });
        // Roles 2.1.1 compares a dynamic parameter against its full ABI encoding.
        conditions[1] = IRolesScoping.ConditionFlat({
            parent: 0, paramType: DYNAMIC, operator: EQUAL_TO, compValue: abi.encode(namespace)
        });
        conditions[2] = IRolesScoping.ConditionFlat({ parent: 0, paramType: DYNAMIC, operator: PASS, compValue: "" });
        conditions[3] = IRolesScoping.ConditionFlat({ parent: 0, paramType: STATIC, operator: PASS, compValue: "" });
        _ownersExec(address(houseRoles), abi.encodeCall(IRoles.scopeTarget, (roleKey, target)));
        _ownersExec(
            address(houseRoles),
            abi.encodeCall(IRolesScoping.scopeFunction, (roleKey, target, selector, conditions, DELEGATE_CALL))
        );
    }

    function _assign(address member, bytes32 roleKey, bool memberOf) internal {
        bytes32[] memory keys = new bytes32[](1);
        keys[0] = roleKey;
        bool[] memory flags = new bool[](1);
        flags[0] = memberOf;
        _ownersExec(address(houseRoles), abi.encodeCall(IRoles.assignRoles, (member, keys, flags)));
    }

    function _claimAs(address member, string memory email, address newOwner) internal returns (address) {
        vm.prank(member);
        (bool success, bytes memory returnData) = houseRoles.execTransactionWithRoleReturnData(
            address(claimer),
            0,
            abi.encodeCall(CompaniesHouseClaimer.claim, (DEVNET_EMAIL_NAMESPACE, email, newOwner)),
            OPERATION_DELEGATECALL,
            DEVNET_CLAIM_ROLE,
            true
        );
        assertTrue(success, "claim");
        return abi.decode(returnData, (address));
    }

    function _mintAs(
        address member,
        bytes32 roleKey,
        string memory namespace,
        string memory company,
        address founder
    )
        internal
        returns (address)
    {
        vm.prank(member);
        (bool success, bytes memory returnData) = houseRoles.execTransactionWithRoleReturnData(
            address(minter),
            0,
            abi.encodeCall(CompanySafeMinter.mint, (namespace, company, founder)),
            OPERATION_DELEGATECALL,
            roleKey,
            true
        );
        assertTrue(success, "mint");
        return abi.decode(returnData, (address));
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
}
