// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { AgentOwner } from "../../src/agents/AgentOwner.sol";
import { IPayments } from "../../src/interfaces/IPayments.sol";
import { Payments } from "../../src/money/Payments.sol";
import { Fork_Test } from "./Fork_Test.t.sol";
import { ISafe } from "./Interfaces.sol";

/// @notice AgentOwner on the real Safe v1.5.0, SafeModuleSetup and Safe4337Module code on the pinned Base
/// Sepolia fork: Amira's personal Safe creates an agent, whose key then signs for the agent's Safe until
/// Amira freezes it, rotates it, sweeps the Safe through Payments and removes it. The agent's key cannot
/// cut Amira off: a call to its own Safe or a delegatecall is refused on both paths it signs through,
/// a Safe transaction and a user operation the 4337 module runs.
contract AgentOwner_Fork_Test is Fork_Test {
    address internal constant SAFE_4337_MODULE = 0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226;
    address internal constant ENTRY_POINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
    // Safe 1.5.0's storage slot for its module guard (Fork_Test has the transaction guard's).
    bytes32 internal constant MODULE_GUARD_SLOT = keccak256("module_manager.module_guard.address");
    address internal constant SAFE_PROXY_FACTORY_V150 = 0x14F2982D601c9458F93bd70B218933A6f8165e7b;
    address internal constant SAFE_L2_V150 = 0xEdd160fEBBD92E350D4D398fb636302fccd67C7e;
    address internal constant SAFE_MODULE_SETUP_V150 = 0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47;

    AgentOwner internal agentOwner;
    Payments internal payments;
    address internal agentKey;
    uint256 internal agentKeyPrivate;
    ISafe internal agentSafe;

    function setUp() public override {
        super.setUp();
        payments = new Payments();
        agentOwner = new AgentOwner(address(payments));
        (agentKey, agentKeyPrivate) = makeAddrAndKey("ledger key");
        address expected = agentOwner.safeAddressFor(agentKey, address(founderSafe));
        _founderExec(address(agentOwner), abi.encodeCall(AgentOwner.create, (agentKey, address(founderSafe))));
        agentSafe = ISafe(expected);
        vm.label(expected, "Ledger's Safe");
    }

    /// @dev One transaction on the agent's Safe, signed by `key`; returns whether the Safe accepted it.
    function _agentExec(uint256 key, address to, bytes memory data) internal returns (bool ok) {
        (ok,) = _agentExecOp(key, to, data, CALL);
    }

    /// @dev As `_agentExec`, with the operation, returning the revert data.
    function _agentExecOp(
        uint256 key,
        address to,
        bytes memory data,
        uint8 operation
    )
        internal
        returns (bool ok, bytes memory result)
    {
        bytes32 txHash =
            agentSafe.getTransactionHash(to, 0, data, operation, 0, 0, 0, address(0), address(0), agentSafe.nonce());
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, txHash);
        (ok, result) = address(agentSafe)
            .call(
                abi.encodeCall(
                    ISafe.execTransaction,
                    (to, 0, data, operation, 0, 0, 0, address(0), payable(address(0)), abi.encodePacked(r, s, v))
                )
            );
    }

    /// @dev What a validated user operation runs: the EntryPoint calls `executeUserOp` on the agent's Safe,
    /// whose fallback hands it to the 4337 module, which makes a module call. Returns the revert data.
    function _userOpExec(
        address to,
        bytes memory data,
        uint8 operation
    )
        internal
        returns (bool ok, bytes memory result)
    {
        vm.prank(ENTRY_POINT);
        (ok, result) = address(agentSafe)
            .call(abi.encodeWithSignature("executeUserOp(address,uint256,bytes,uint8)", to, 0, data, operation));
    }

    /// @dev Every call the agent's key could make to cut its owner off.
    function _cutOffCalls() internal view returns (bytes[] memory calls) {
        calls = new bytes[](5);
        calls[0] = abi.encodeWithSignature("disableModule(address,address)", SENTINEL, address(agentOwner));
        calls[1] = abi.encodeWithSignature("setGuard(address)", address(0));
        calls[2] = abi.encodeWithSignature("setModuleGuard(address)", address(0));
        calls[3] = abi.encodeWithSignature("addOwnerWithThreshold(address,uint256)", users.bob, 1);
        calls[4] = abi.encodeWithSignature("swapOwner(address,address,address)", SENTINEL, agentKey, users.bob);
    }

    function _assertSelfCallRefused(bool ok, bytes memory result, uint8 operation, address to) internal view {
        assertFalse(ok, "refused");
        assertEq(result, abi.encodeWithSelector(AgentOwner.AgentSelfCall.selector, address(agentSafe), to, operation));
    }

    /// @dev The owner still freezes, unfreezes, rotates, sweeps and removes the agent.
    function _assertOwnerStillInControl() internal {
        assertTrue(agentSafe.isModuleEnabled(address(agentOwner)));
        _founderExec(address(agentOwner), abi.encodeCall(AgentOwner.freeze, (address(agentSafe))));
        assertEq(agentSafe.getOwners()[0], address(agentOwner));
        _founderExec(address(agentOwner), abi.encodeCall(AgentOwner.unfreeze, (address(agentSafe))));
        (address newKey,) = makeAddrAndKey("ledger key after the attempt");
        _founderExec(address(agentOwner), abi.encodeCall(AgentOwner.swapSigner, (address(agentSafe), agentKey, newKey)));
        assertEq(agentSafe.getOwners()[0], newKey);
        usdc.mint(address(agentSafe), 3 * USDC_UNIT);
        _founderExec(
            address(agentOwner),
            abi.encodeCall(AgentOwner.sweep, (address(agentSafe), address(founderSafe), address(usdc)))
        );
        assertEq(usdc.balanceOf(address(agentSafe)), 0);
        _founderExec(address(agentOwner), abi.encodeCall(AgentOwner.remove, (address(agentSafe), new address[](0))));
        assertTrue(agentOwner.agentOf(address(agentSafe)).removed);
    }

    function test_CreateDeploysTheAgentsSafeWithItsKeyAndTheModules() external view {
        assertGt(address(agentSafe).code.length, 0);
        address[] memory owners = agentSafe.getOwners();
        assertEq(owners.length, 1);
        assertEq(owners[0], agentKey);
        assertEq(agentSafe.getThreshold(), 1);
        assertTrue(agentSafe.isModuleEnabled(address(agentOwner)));
        assertTrue(agentSafe.isModuleEnabled(SAFE_4337_MODULE));
        assertEq(address(uint160(uint256(vm.load(address(agentSafe), GUARD_SLOT)))), address(agentOwner));
        assertEq(address(uint160(uint256(vm.load(address(agentSafe), MODULE_GUARD_SLOT)))), address(agentOwner));
        AgentOwner.Agent memory agent = agentOwner.agentOf(address(agentSafe));
        assertEq(agent.owner, address(founderSafe));
        assertEq(agent.signer, agentKey);
    }

    function test_TheAgentsKeySignsUntilItsOwnerFreezesIt() external {
        usdc.mint(address(agentSafe), 10 * USDC_UNIT);
        bytes memory pay = abi.encodeCall(usdc.transfer, (users.bob, USDC_UNIT));
        assertTrue(_agentExec(agentKeyPrivate, address(usdc), pay), "active key signs");

        _founderExec(address(agentOwner), abi.encodeCall(AgentOwner.freeze, (address(agentSafe))));
        assertEq(agentSafe.getOwners()[0], address(agentOwner));
        assertFalse(_agentExec(agentKeyPrivate, address(usdc), pay), "frozen key signs nothing");

        _founderExec(address(agentOwner), abi.encodeCall(AgentOwner.unfreeze, (address(agentSafe))));
        assertTrue(_agentExec(agentKeyPrivate, address(usdc), pay), "unfrozen key signs again");
    }

    function test_SwapSignerRetiresTheOldKey() external {
        (address newKey, uint256 newKeyPrivate) = makeAddrAndKey("ledger key 2");
        _founderExec(address(agentOwner), abi.encodeCall(AgentOwner.swapSigner, (address(agentSafe), agentKey, newKey)));
        assertEq(agentSafe.getOwners()[0], newKey);
        usdc.mint(address(agentSafe), USDC_UNIT);
        bytes memory pay = abi.encodeCall(usdc.transfer, (users.bob, 1));
        assertFalse(_agentExec(agentKeyPrivate, address(usdc), pay), "old key signs nothing");
        assertTrue(_agentExec(newKeyPrivate, address(usdc), pay), "new key signs");
    }

    function test_SweepPaysTheOwnerThroughPayments() external {
        usdc.mint(address(agentSafe), 40 * USDC_UNIT);
        uint256 before = usdc.balanceOf(address(founderSafe));
        vm.expectEmit(false, true, true, false, address(payments));
        emit IPayments.PaymentSent(bytes32(0), address(agentSafe), address(founderSafe), address(usdc), 0, 0, 0);
        _founderExec(
            address(agentOwner),
            abi.encodeCall(AgentOwner.sweep, (address(agentSafe), address(founderSafe), address(usdc)))
        );
        assertEq(usdc.balanceOf(address(agentSafe)), 0);
        assertEq(usdc.balanceOf(address(founderSafe)) - before, 40 * USDC_UNIT);
    }

    function test_RemoveSweepsAndLeavesNoKey() external {
        usdc.mint(address(agentSafe), 7 * USDC_UNIT);
        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);
        uint256 before = usdc.balanceOf(address(founderSafe));
        _founderExec(address(agentOwner), abi.encodeCall(AgentOwner.remove, (address(agentSafe), tokens)));
        assertEq(usdc.balanceOf(address(founderSafe)) - before, 7 * USDC_UNIT);
        assertEq(agentSafe.getOwners()[0], address(agentOwner));
        assertTrue(agentOwner.agentOf(address(agentSafe)).removed);
        assertFalse(_agentExec(agentKeyPrivate, address(usdc), abi.encodeCall(usdc.transfer, (users.bob, 0))));
    }

    function test_OnlyTheOwnersSafeActs() external {
        vm.prank(agentKey);
        vm.expectRevert(abi.encodeWithSelector(AgentOwner.NotOwner.selector, agentKey));
        agentOwner.freeze(address(agentSafe));
    }

    function test_TheAgentsKeyCannotCutItsOwnerOffWithASafeTransaction() external {
        bytes[] memory calls = _cutOffCalls();
        for (uint256 index; index < calls.length; ++index) {
            (bool ok, bytes memory result) = _agentExecOp(agentKeyPrivate, address(agentSafe), calls[index], CALL);
            _assertSelfCallRefused(ok, result, CALL, address(agentSafe));
        }
        (bool delegated, bytes memory refused) =
            _agentExecOp(agentKeyPrivate, address(usdc), abi.encodeCall(usdc.transfer, (users.bob, 0)), DELEGATECALL);
        _assertSelfCallRefused(delegated, refused, DELEGATECALL, address(usdc));
        _assertOwnerStillInControl();
    }

    function test_TheAgentsKeyCannotCutItsOwnerOffWithAUserOperation() external {
        bytes[] memory calls = _cutOffCalls();
        for (uint256 index; index < calls.length; ++index) {
            (bool ok, bytes memory result) = _userOpExec(address(agentSafe), calls[index], CALL);
            _assertSelfCallRefused(ok, result, CALL, address(agentSafe));
        }
        (bool delegated, bytes memory refused) =
            _userOpExec(address(usdc), abi.encodeCall(usdc.transfer, (users.bob, 0)), DELEGATECALL);
        _assertSelfCallRefused(delegated, refused, DELEGATECALL, address(usdc));
        _assertOwnerStillInControl();
    }

    function test_CreateAdoptsASafeSomeoneDeployedThroughTheFactoryFirst() external {
        (address key, uint256 keyPrivate) = makeAddrAndKey("griefed key");
        address expected = agentOwner.safeAddressFor(key, address(founderSafe));
        address[] memory modules = new address[](2);
        modules[0] = SAFE_4337_MODULE;
        modules[1] = address(agentOwner);
        address[] memory owners = new address[](1);
        owners[0] = address(agentOwner);
        bytes memory initializer = abi.encodeWithSignature(
            "setup(address[],uint256,address,bytes,address,address,uint256,address)",
            owners,
            uint256(1),
            SAFE_MODULE_SETUP_V150,
            abi.encodeWithSignature("enableModules(address[])", modules),
            SAFE_4337_MODULE,
            address(0),
            uint256(0),
            address(0)
        );
        vm.prank(users.eve);
        (bool deployed, bytes memory proxy) = SAFE_PROXY_FACTORY_V150.call(
            abi.encodeWithSignature(
                "createProxyWithNonce(address,bytes,uint256)",
                SAFE_L2_V150,
                initializer,
                uint256(keccak256(abi.encode(address(founderSafe), key)))
            )
        );
        assertTrue(deployed, "anyone can deploy the derived Safe");
        assertEq(abi.decode(proxy, (address)), expected);
        assertEq(ISafe(expected).getOwners()[0], address(agentOwner), "nobody can sign for it");

        _founderExec(address(agentOwner), abi.encodeCall(AgentOwner.create, (key, address(founderSafe))));
        agentSafe = ISafe(expected);
        assertEq(agentSafe.getOwners()[0], key);
        assertEq(address(uint160(uint256(vm.load(expected, GUARD_SLOT)))), address(agentOwner));
        assertEq(address(uint160(uint256(vm.load(expected, MODULE_GUARD_SLOT)))), address(agentOwner));
        assertEq(agentOwner.agentOf(expected).owner, address(founderSafe));
        usdc.mint(expected, USDC_UNIT);
        assertTrue(_agentExec(keyPrivate, address(usdc), abi.encodeCall(usdc.transfer, (users.bob, 1))));
    }

    function test_AUserOperationValidatedBeforeAFreezeCannotRunAfterIt() external {
        usdc.mint(address(agentSafe), 5 * USDC_UNIT);
        bytes memory pay = abi.encodeCall(usdc.transfer, (users.bob, USDC_UNIT));
        _founderExec(address(agentOwner), abi.encodeCall(AgentOwner.freeze, (address(agentSafe))));
        (bool ok, bytes memory result) = _userOpExec(address(usdc), pay, CALL);
        assertFalse(ok, "frozen");
        assertEq(result, abi.encodeWithSelector(AgentOwner.AgentInactive.selector, address(agentSafe)));

        _founderExec(address(agentOwner), abi.encodeCall(AgentOwner.remove, (address(agentSafe), new address[](0))));
        (ok, result) = _userOpExec(address(usdc), pay, CALL);
        assertFalse(ok, "removed");
        assertEq(result, abi.encodeWithSelector(AgentOwner.AgentInactive.selector, address(agentSafe)));
        assertEq(usdc.balanceOf(address(agentSafe)), 5 * USDC_UNIT);
    }

    function test_AUserOperationStillPaysFromTheAgentsSafe() external {
        usdc.mint(address(agentSafe), 5 * USDC_UNIT);
        (bool ok,) = _userOpExec(address(usdc), abi.encodeCall(usdc.transfer, (users.bob, USDC_UNIT)), CALL);
        assertTrue(ok, "a payment through the 4337 module runs");
        assertEq(usdc.balanceOf(address(agentSafe)), 4 * USDC_UNIT);
    }
}
