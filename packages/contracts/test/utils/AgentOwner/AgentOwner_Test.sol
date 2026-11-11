// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { AgentOwner } from "../../../src/agents/AgentOwner.sol";
import { IPayments } from "../../../src/interfaces/IPayments.sol";
import { Payments } from "../../../src/money/Payments.sol";
import { Base_Test } from "../../Base.t.sol";
import { MockAgentModuleSetup, MockAgentProxyFactory, MockAgentSafe } from "./AgentMocks.sol";

/// @notice The hermetic AgentOwner fixture: a mock factory and SafeModuleSetup etched at their canonical
/// addresses, the real Payments, an owner (a person's Safe, played by an address) and the agent's key.
abstract contract AgentOwner_Test is Base_Test {
    address internal constant SAFE_PROXY_FACTORY = 0x14F2982D601c9458F93bd70B218933A6f8165e7b;
    address internal constant SAFE_L2_SINGLETON = 0xEdd160fEBBD92E350D4D398fb636302fccd67C7e;
    address internal constant SAFE_MODULE_SETUP = 0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47;
    address internal constant SAFE_4337_MODULE = 0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226;
    address internal constant SENTINEL_OWNERS = address(0x1);

    AgentOwner internal agentOwner;
    Payments internal payments;
    MockAgentProxyFactory internal factory;
    /// @dev The owner's Safe.
    address internal owner;
    /// @dev The agent's key.
    address internal signer;
    /// @dev The Safe derived for `signer` and `owner`.
    address internal derived;

    function setUp() public virtual override {
        super.setUp();
        payments = new Payments();
        agentOwner = new AgentOwner(address(payments));
        vm.etch(SAFE_PROXY_FACTORY, type(MockAgentProxyFactory).runtimeCode);
        vm.etch(SAFE_MODULE_SETUP, type(MockAgentModuleSetup).runtimeCode);
        factory = MockAgentProxyFactory(SAFE_PROXY_FACTORY);
        owner = users.amira;
        signer = makeAddr("agent key");
        derived = agentOwner.safeAddressFor(signer, owner);
        factory.setLanding(derived);
        vm.label(address(agentOwner), "AgentOwner");
        vm.label(derived, "agent Safe");
    }

    function _create() internal returns (address safe) {
        vm.prank(owner);
        safe = agentOwner.create(signer, owner);
    }

    /// @dev Deploy the agent's Safe straight through the factory, as anyone can, before `create`.
    function _predeploy() internal {
        vm.prank(users.eve);
        factory.createProxyWithNonce(
            SAFE_L2_SINGLETON, _expectedInitializer(), uint256(keccak256(abi.encode(owner, signer)))
        );
    }

    function _freeze(address safe) internal {
        vm.prank(owner);
        agentOwner.freeze(safe);
    }

    function _remove(address safe) internal {
        vm.prank(owner);
        agentOwner.remove(safe, new address[](0));
    }

    function _safeOwner(address safe) internal view returns (address) {
        return MockAgentSafe(safe).owner();
    }

    /// @dev The Safe setup `create` must use, written out independently of AgentOwner: AgentOwner is the
    /// one owner, and `create` swaps the agent's key in after setting the guards.
    function _expectedInitializer() internal view returns (bytes memory) {
        address[] memory modules = new address[](2);
        modules[0] = SAFE_4337_MODULE;
        modules[1] = address(agentOwner);
        address[] memory owners = new address[](1);
        owners[0] = address(agentOwner);
        return abi.encodeWithSignature(
            "setup(address[],uint256,address,bytes,address,address,uint256,address)",
            owners,
            uint256(1),
            SAFE_MODULE_SETUP,
            abi.encodeWithSignature("enableModules(address[])", modules),
            SAFE_4337_MODULE,
            address(0),
            uint256(0),
            address(0)
        );
    }

    /// @dev The sweep's payment, written out independently of AgentOwner.
    function _expectedSweep(
        address safe,
        address to,
        address token,
        uint256 amount,
        uint256 count
    )
        internal
        view
        returns (IPayments.PaymentItem memory item)
    {
        item = IPayments.PaymentItem({
            paymentId: bytes32(0),
            recipient: to,
            token: token,
            amount: amount,
            kind: 9,
            documentHash: keccak256(abi.encode("capxul:agent-sweep:document", safe, to, token, amount, count)),
            jobNonce: keccak256(abi.encode("capxul:agent-sweep", safe, count)),
            executor: safe
        });
        item.paymentId = payments.paymentId(item);
    }
}
