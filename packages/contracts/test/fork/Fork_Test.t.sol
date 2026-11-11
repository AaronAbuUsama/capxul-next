// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Base_Test } from "../Base.t.sol";
import { Addresses } from "./Addresses.sol";
import { IHats, IHatsSignerGate, IModuleProxyFactory, IRoles, ISafe, ISafeProxyFactory } from "./Interfaces.sol";

/// @notice The fork base: Base Sepolia at the pinned block, with a company built on the real
/// third-party contracts as rulings D1 and D2 say.
///
/// - Amira's personal Safe 1.4.1 (one owner: Amira's key) wears the Director hat and is the company
///   Safe's only owner.
/// - The company Safe 1.4.1 has Hats Signer Gate v2 as its ONLY module and its guard, with threshold
///   ABSOLUTE {min 1, target 1}.
/// - Zodiac Roles v2 is a module ON THE GATE (avatar = company Safe, target = Gate, owner = company
///   Safe), never on the Safe.
/// - A stand-in for the Shareholders (the Governor, later) wears the top hat, which admins the
///   Director hat and owns the Gate. The Director hat is mutable so Hats Elections can be attached
///   later with changeHatEligibility (D2); until then its eligibility and toggle are an address with
///   no code, so Hats uses its stored values (R3, Q3 validation note 1).
///
/// Board actions follow D1: the Director approves the hash from her own Safe (approveHash), then
/// anyone calls execTransaction with a v = 1 signature, which the Gate counts
/// (HatsSignerGate.sol:667).
abstract contract Fork_Test is Base_Test {
    struct Call {
        address to;
        uint256 value;
        bytes data;
    }

    uint8 internal constant CALL = 0;
    uint8 internal constant DELEGATECALL = 1;
    address internal constant SENTINEL = address(0x1);
    /// @dev keccak256("guard_manager.guard.address"), Safe 1.4.1's guard slot.
    bytes32 internal constant GUARD_SLOT = 0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8;

    IHats internal constant HATS = IHats(Addresses.HATS);

    uint256 internal amiraKey;
    ISafe internal founderSafe;
    ISafe internal companySafe;
    IHatsSignerGate internal gate;
    IRoles internal companyRoles;
    address internal shareholders;
    address internal noModule;
    uint256 internal topHat;
    uint256 internal directorHat;

    function setUp() public virtual override {
        vm.createSelectFork(vm.envOr("BASE_SEPOLIA_FORK_URL", string("https://sepolia.base.org")), Addresses.FORK_BLOCK);
        _assertThirdPartyCode();
        super.setUp();
    }

    /// @dev Replaces Base_Test's mocks with the real company. `safe`, `roles` and `hats` stay unset.
    function _deployCompany() internal virtual override {
        // forge-std's makeAddr("amira") is the address of this key.
        amiraKey = uint256(keccak256(abi.encodePacked("amira")));
        shareholders = makeAddr("shareholders");
        noModule = makeAddr("no module");

        founderSafe = _newSafe(users.amira, 1);
        companySafe = _newSafe(address(founderSafe), 2);
        vm.label(address(founderSafe), "Amira's Safe");
        vm.label(address(companySafe), "Company Safe");

        // The Board's hats: the Shareholders' top hat admins the mutable Director hat.
        vm.startPrank(shareholders);
        topHat = HATS.mintTopHat(shareholders, "Shareholders", "");
        directorHat = HATS.createHat(topHat, "Director", 5, noModule, noModule, true, "");
        HATS.mintHat(directorHat, address(founderSafe));
        vm.stopPrank();

        // Roles first, aimed at the Safe; the attach batch below points it at the Gate (R3, Q1 step 2).
        companyRoles = IRoles(
            IModuleProxyFactory(Addresses.MODULE_PROXY_FACTORY)
                .deployModule(
                    Addresses.ROLES_V2_MASTERCOPY,
                    abi.encodeCall(IRoles.setUp, (abi.encode(companySafe, companySafe, companySafe))),
                    1
                )
        );
        vm.label(address(companyRoles), "Roles");

        uint256[] memory signerHats = new uint256[](1);
        signerHats[0] = directorHat;
        address[] memory gateModules = new address[](1);
        gateModules[0] = address(companyRoles);
        IHatsSignerGate.SetupParams memory params = IHatsSignerGate.SetupParams({
            ownerHat: topHat,
            signerHats: signerHats,
            safe: address(companySafe),
            thresholdConfig: IHatsSignerGate.ThresholdConfig({
                thresholdType: IHatsSignerGate.TargetThresholdType.ABSOLUTE, min: 1, target: 1
            }),
            locked: false,
            claimableFor: false,
            implementation: Addresses.HATS_SIGNER_GATE_V2,
            hsgGuard: address(0),
            hsgModules: gateModules
        });
        gate = IHatsSignerGate(
            IModuleProxyFactory(Addresses.MODULE_PROXY_FACTORY)
                .deployModule(
                    Addresses.HATS_SIGNER_GATE_V2, abi.encodeCall(IHatsSignerGate.setUp, (abi.encode(params))), 1
                )
        );
        vm.label(address(gate), "Hats Signer Gate");

        // One Board batch attaches the Gate as module and guard and aims Roles at it. Safe 1.4.1 reads
        // the guard once, before the batch, so the new guard does not check this batch (R3, Q1).
        Call[] memory attach = new Call[](3);
        attach[0] = Call(address(companySafe), 0, abi.encodeCall(ISafe.enableModule, (address(gate))));
        attach[1] = Call(address(companySafe), 0, abi.encodeCall(ISafe.setGuard, (address(gate))));
        attach[2] = Call(address(companyRoles), 0, abi.encodeCall(IRoles.setTarget, (address(gate))));
        _boardBatch(attach);

        // Amira's Safe is already an owner, so claiming registers it and leaves the threshold at 1.
        _founderExec(address(gate), abi.encodeCall(IHatsSignerGate.claimSigner, (directorHat)));

        usdc.mint(address(companySafe), 1_000_000 * USDC_UNIT);
    }

    // ------------------------------------------------------------------ the Board (D1)

    /// @dev Amira approves a company Safe transaction from her own Safe and returns the v = 1
    /// signature that names her Safe.
    function _boardApprove(
        address to,
        uint256 value,
        bytes memory data,
        uint8 operation
    )
        internal
        returns (bytes memory signature)
    {
        bytes32 txHash = companySafe.getTransactionHash(
            to, value, data, operation, 0, 0, 0, address(0), address(0), companySafe.nonce()
        );
        _founderExec(address(companySafe), abi.encodeCall(ISafe.approveHash, (txHash)));
        signature = abi.encodePacked(bytes32(uint256(uint160(address(founderSafe)))), bytes32(0), uint8(1));
    }

    function _execCompany(address to, uint256 value, bytes memory data, uint8 operation, bytes memory sig) internal {
        assertTrue(
            companySafe.execTransaction(to, value, data, operation, 0, 0, 0, address(0), payable(address(0)), sig),
            "company Safe transaction"
        );
    }

    /// @dev A Board batch: one MultiSendCallOnly 1.4.1 delegatecall, approved and executed.
    function _boardBatch(Call[] memory calls) internal {
        bytes memory data = _multiSend(calls);
        bytes memory sig = _boardApprove(Addresses.MULTI_SEND_CALL_ONLY_141, 0, data, DELEGATECALL);
        _execCompany(Addresses.MULTI_SEND_CALL_ONLY_141, 0, data, DELEGATECALL, sig);
    }

    function _multiSend(Call[] memory calls) internal pure returns (bytes memory) {
        bytes memory packed;
        for (uint256 i; i < calls.length; ++i) {
            packed = abi.encodePacked(packed, CALL, calls[i].to, calls[i].value, calls[i].data.length, calls[i].data);
        }
        return abi.encodeWithSignature("multiSend(bytes)", packed);
    }

    // ------------------------------------------------------------------ Safes

    /// @dev Amira's own Safe runs a call, signed with her key.
    function _founderExec(address to, bytes memory data) internal {
        bytes32 txHash =
            founderSafe.getTransactionHash(to, 0, data, CALL, 0, 0, 0, address(0), address(0), founderSafe.nonce());
        assertTrue(
            founderSafe.execTransaction(
                to, 0, data, CALL, 0, 0, 0, address(0), payable(address(0)), _amiraSign(txHash)
            ),
            "Amira's Safe transaction"
        );
    }

    function _amiraSign(bytes32 txHash) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(amiraKey, txHash);
        return abi.encodePacked(r, s, v);
    }

    function _newSafe(address owner, uint256 saltNonce) internal returns (ISafe) {
        address[] memory owners = new address[](1);
        owners[0] = owner;
        bytes memory init = abi.encodeCall(
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
        );
        return ISafe(
            ISafeProxyFactory(Addresses.SAFE_PROXY_FACTORY_150)
                .createProxyWithNonce(Addresses.SAFE_L2_150, init, saltNonce)
        );
    }

    // ------------------------------------------------------------------ checks

    /// @dev D1: the Gate is the company Safe's only module and its guard; Roles is not a Safe module.
    function _assertGateIsOnlyModuleAndGuard() internal view {
        (address[] memory modules, address next) = companySafe.getModulesPaginated(SENTINEL, 10);
        assertEq(modules.length, 1, "one Safe module");
        assertEq(modules[0], address(gate), "the Gate is the Safe module");
        assertEq(next, SENTINEL, "no further Safe modules");
        assertEq(address(uint160(uint256(vm.load(address(companySafe), GUARD_SLOT)))), address(gate), "guard");
        assertFalse(companySafe.isModuleEnabled(address(companyRoles)), "Roles is not a Safe module");
        assertTrue(gate.isModuleEnabled(address(companyRoles)), "Roles is a Gate module");
    }

    /// @dev Every pinned contract has code at the fork block; Roles is the 2.1 mastercopy.
    function _assertThirdPartyCode() internal view {
        assertEq(block.chainid, Addresses.CHAIN_ID, "Base Sepolia");
        address[12] memory pinned = [
            Addresses.SAFE_L2_150,
            Addresses.SAFE_PROXY_FACTORY_150,
            Addresses.MULTI_SEND_CALL_ONLY_141,
            Addresses.MULTI_SEND_141,
            Addresses.COMPATIBILITY_FALLBACK_HANDLER_150,
            Addresses.CREATE_CALL_141,
            Addresses.ROLES_V2_MASTERCOPY,
            Addresses.ROLES_MULTISEND_UNWRAPPER,
            Addresses.MODULE_PROXY_FACTORY,
            Addresses.HATS,
            Addresses.HATS_MODULE_FACTORY,
            Addresses.HATS_SIGNER_GATE_V2
        ];
        for (uint256 i; i < pinned.length; ++i) {
            assertGt(pinned[i].code.length, 0, "pinned contract has code");
        }
        assertGt(Addresses.HATS_ELECTION_ELIGIBILITY.code.length, 0, "Hats Elections has code");
        assertEq(Addresses.ROLES_V2_MASTERCOPY.codehash, Addresses.ROLES_V2_CODEHASH, "Roles 2.1 mastercopy");
    }
}
