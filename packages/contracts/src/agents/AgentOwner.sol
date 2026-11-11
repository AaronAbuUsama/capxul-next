// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IPayments } from "../interfaces/IPayments.sol";

interface ISafeProxyFactoryForAgent {
    function createProxyWithNonce(
        address singleton,
        bytes memory initializer,
        uint256 saltNonce
    )
        external
        returns (address proxy);
}

interface ISafeModuleSetupForAgent {
    function enableModules(address[] calldata modules) external;
}

interface ISafeForAgent {
    function swapOwner(address prevOwner, address oldOwner, address newOwner) external;
    function setGuard(address guard) external;
    function setModuleGuard(address moduleGuard) external;
    function execTransactionFromModuleReturnData(
        address to,
        uint256 value,
        bytes memory data,
        uint8 operation
    )
        external
        returns (bool success, bytes memory returnData);
}

/// @dev Safe 1.5.0's transaction guard (`setGuard`): runs before `execTransaction`.
interface ISafeTransactionGuard {
    function checkTransaction(
        address to,
        uint256 value,
        bytes memory data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures,
        address msgSender
    )
        external;
    function checkAfterExecution(bytes32 hash, bool success) external;
}

/// @dev Safe 1.5.0's module guard (`setModuleGuard`): runs before every `execTransactionFromModule`.
interface ISafeModuleGuard {
    function checkModuleTransaction(
        address to,
        uint256 value,
        bytes memory data,
        uint8 operation,
        address module
    )
        external
        returns (bytes32 moduleTxHash);
    function checkAfterModuleExecution(bytes32 txHash, bool success) external;
}

/// @title AgentOwner
/// @notice Gives an agent a Safe of its own, with its key as the one signer, and gives the agent's owner
/// (a person's or an Organization's Safe) full control of it without the agent's consent: freeze it,
/// replace its key, sweep what it holds and remove it (book pages agent create, freeze, key rotate, sweep
/// and remove; CAP-1128 to CAP-1133).
/// @dev One contract for every agent. `create` deploys the agent's Safe through the canonical Safe v1.5.0
/// proxy factory with `setup([AgentOwner], 1, SafeModuleSetup, enableModules([Safe4337Module, AgentOwner]),
/// Safe4337Module, 0, 0, 0)` and salt nonce `keccak256(abi.encode(owner, signer))`, so this contract is
/// the Safe's first owner and its module. The factory is permissionless, so anyone can deploy that same
/// Safe first; it then has only this contract as owner, which never signs, so nobody can act on it, and
/// `create` adopts it as if it had deployed it. `create` makes this contract the Safe's transaction guard
/// and its module guard, then swaps the agent's key in as the one owner, so the agent signs sponsored user
/// operations like a personal Safe. From then on the agent's key can neither call
/// its own Safe nor delegatecall, whether it signs a Safe transaction or a user operation (Aaron's ruling
/// on #3481, 2 Nov 2026): it cannot disable this module, drop a guard, or change the owners or threshold.
/// Every owner power acts through `execTransactionFromModule` from this contract, which the module guard
/// lets through. A frozen or removed agent has this contract as its Safe's one owner: it cannot sign, so
/// neither `execTransaction` nor the 4337 module accepts a signature from the agent's key, and the
/// module guard refuses any user operation it signed earlier that is still waiting to run.
contract AgentOwner is ISafeTransactionGuard, ISafeModuleGuard, IERC165 {
    // Safe v1.5.0 (SafeL2), SafeModuleSetup and Safe4337Module 0.3.0, the same address on every chain with
    // the canonical deployments.
    address internal constant SAFE_PROXY_FACTORY = 0x14F2982D601c9458F93bd70B218933A6f8165e7b;
    address internal constant SAFE_L2_SINGLETON = 0xEdd160fEBBD92E350D4D398fb636302fccd67C7e;
    address internal constant SAFE_MODULE_SETUP = 0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47;
    address internal constant SAFE_4337_MODULE = 0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226;
    address internal constant SENTINEL_OWNERS = address(0x1);
    uint8 internal constant CALL = 0;

    /// @notice The payment kind a sweep stamps (architecture.md, payment kinds): agent sweep.
    uint16 public constant SWEEP_KIND = 9;

    /// @notice One agent, by its Safe.
    /// @param owner The Safe that owns the agent: a person's personal Safe or an Organization's Safe.
    /// @param signer The agent's key. While frozen it is kept here and not on the Safe.
    /// @param frozen The key is swapped out for this contract until `unfreeze`.
    /// @param removed The agent has ended; every owner power refuses.
    struct Agent {
        address owner;
        address signer;
        bool frozen;
        bool removed;
    }

    /// @notice Payments, through which a sweep moves the agent's money.
    IPayments public immutable PAYMENTS;

    mapping(address safe => Agent) internal _agents;

    /// @notice How many sweeps each agent Safe has paid: the sweep's job nonce counter.
    mapping(address safe => uint256) public sweeps;

    /// @notice An agent's Safe exists, owned by `owner`, with `signer` as its one signer.
    event AgentCreated(address indexed safe, address indexed owner, address indexed signer);
    /// @notice The agent's key can no longer sign.
    event AgentFrozen(address indexed safe);
    /// @notice The agent's key signs again.
    event AgentUnfrozen(address indexed safe);
    /// @notice The agent's key changed from `oldSigner` to `newSigner`.
    event AgentSignerSwapped(address indexed safe, address oldSigner, address newSigner);
    /// @notice `amount` of `token` moved from the agent's Safe to `to`.
    event AgentSwept(address indexed safe, address indexed to, address indexed token, uint256 amount);
    /// @notice The agent ended: its Safe was swept to its owner and no key signs for it.
    event AgentRemoved(address indexed safe);

    /// @notice The payments address is zero.
    error ZeroPayments();
    /// @notice The caller is not the owner the call names, or not the agent's owner.
    error NotOwner(address caller);
    /// @notice The signer is zero, the owners sentinel, this contract or the owner.
    error InvalidSigner();
    /// @notice The agent's Safe already belongs to an agent.
    error AgentExists(address safe);
    /// @notice The factory deployed somewhere other than the derived address.
    error DerivedAddressMismatch(address expected, address deployed);
    /// @notice No agent has this Safe.
    error UnknownAgent(address safe);
    /// @notice The agent was removed.
    error AgentIsRemoved(address safe);
    /// @notice The agent is already frozen.
    error AlreadyFrozen(address safe);
    /// @notice The agent is not frozen.
    error NotFrozen(address safe);
    /// @notice The old signer is not the agent's key.
    error SignerMismatch(address expected, address supplied);
    /// @notice The sweep's recipient is zero or the agent's own Safe.
    error InvalidRecipient();
    /// @notice The agent's Safe refused or failed the module call.
    error ModuleCallFailed(address safe);
    /// @notice The agent tried to call its own Safe or to delegatecall: only its owner changes the Safe.
    error AgentSelfCall(address safe, address to, uint8 operation);
    /// @notice The agent is frozen or removed: only its owner acts on its Safe.
    error AgentInactive(address safe);

    constructor(address payments_) {
        if (payments_ == address(0)) revert ZeroPayments();
        PAYMENTS = IPayments(payments_);
    }

    modifier onlyAgentOwner(address safe) {
        _requireAgentOwner(safe);
        _;
    }

    /// @notice Deploy the agent's Safe with `signer` as its one signer, this contract and the 4337 module
    /// enabled, and `owner` as the agent's owner. The owner's Safe calls it: its signature is the consent.
    /// A Safe someone else already deployed at the derived address, and no agent has, is adopted: the
    /// address binds the exact setup, so it holds only this contract as owner and these modules.
    /// @param signer The agent's key.
    /// @param owner The owner's Safe; must be the caller.
    /// @return safe The agent's Safe.
    function create(address signer, address owner) external returns (address safe) {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _requireSigner(signer, owner);
        bytes memory initializer = _initializer();
        uint256 saltNonce = _saltNonce(signer, owner);
        safe = _safeAddress(initializer, saltNonce);
        if (_agents[safe].owner != address(0)) revert AgentExists(safe);
        _agents[safe] = Agent({ owner: owner, signer: signer, frozen: false, removed: false });
        if (safe.code.length == 0) {
            address proxy = ISafeProxyFactoryForAgent(SAFE_PROXY_FACTORY)
                .createProxyWithNonce(SAFE_L2_SINGLETON, initializer, saltNonce);
            if (proxy != safe) revert DerivedAddressMismatch(safe, proxy);
        }
        // The calls go to the canonical factory, which deploys the derived proxy, and to that new Safe;
        // neither reenters here.
        // forge-lint: disable-next-line(reentrancy-events)
        emit AgentCreated(safe, owner, signer);
        _call(safe, safe, abi.encodeCall(ISafeForAgent.setGuard, (address(this))));
        _call(safe, safe, abi.encodeCall(ISafeForAgent.setModuleGuard, (address(this))));
        _swapOwner(safe, address(this), signer);
    }

    /// @notice Stop the agent's key from signing: this contract takes its place on the Safe.
    /// @param safe The agent's Safe.
    function freeze(address safe) external onlyAgentOwner(safe) {
        Agent storage agent = _agents[safe];
        if (agent.frozen) revert AlreadyFrozen(safe);
        agent.frozen = true;
        emit AgentFrozen(safe);
        _swapOwner(safe, agent.signer, address(this));
    }

    /// @notice Let the agent's key sign again.
    /// @param safe The agent's Safe.
    function unfreeze(address safe) external onlyAgentOwner(safe) {
        Agent storage agent = _agents[safe];
        if (!agent.frozen) revert NotFrozen(safe);
        agent.frozen = false;
        emit AgentUnfrozen(safe);
        _swapOwner(safe, address(this), agent.signer);
    }

    /// @notice Replace the agent's key. A frozen agent keeps the new key here until `unfreeze`.
    /// @param safe The agent's Safe.
    /// @param oldSigner The agent's key now.
    /// @param newSigner The new key.
    function swapSigner(address safe, address oldSigner, address newSigner) external onlyAgentOwner(safe) {
        Agent storage agent = _agents[safe];
        if (oldSigner != agent.signer) revert SignerMismatch(agent.signer, oldSigner);
        _requireSigner(newSigner, agent.owner);
        agent.signer = newSigner;
        emit AgentSignerSwapped(safe, oldSigner, newSigner);
        if (!agent.frozen) _swapOwner(safe, oldSigner, newSigner);
    }

    /// @notice Move all of `token` the agent's Safe holds to `to`, as one `Payments.send` from the Safe.
    /// @param safe The agent's Safe.
    /// @param to The recipient.
    /// @param token The token.
    /// @return amount What moved; zero when the Safe held none, and nothing is called.
    function sweep(address safe, address to, address token) external onlyAgentOwner(safe) returns (uint256 amount) {
        return _sweep(safe, to, token);
    }

    /// @notice End the agent: sweep each token to the owner, then leave no key that can sign.
    /// @param safe The agent's Safe.
    /// @param tokens The tokens to sweep to the owner.
    function remove(address safe, address[] calldata tokens) external onlyAgentOwner(safe) {
        Agent storage agent = _agents[safe];
        // Each sweep reverts the whole removal when the Safe refuses it; the calls go only to the agent's
        // Safe, which the owner controls.
        // forge-lint: disable-next-line(calls-loop)
        for (uint256 index; index < tokens.length; ++index) {
            _sweep(safe, agent.owner, tokens[index]);
        }
        if (!agent.frozen) _swapOwner(safe, agent.signer, address(this));
        agent.removed = true;
        // The sweeps' and the swap's calls go only to the agent's Safe and Payments; neither reenters here.
        // forge-lint: disable-next-line(reentrancy-events)
        emit AgentRemoved(safe);
    }

    /// @notice Transaction guard: refuses a Safe transaction the agent's key signs when it calls the agent's
    /// own Safe or delegatecalls. `msg.sender` is the Safe.
    function checkTransaction(
        address to,
        uint256,
        bytes memory,
        uint8 operation,
        uint256,
        uint256,
        uint256,
        address,
        address payable,
        bytes memory,
        address
    )
        external
        view
    {
        _requireNotSelfCall(msg.sender, to, operation);
    }

    /// @notice Module guard: refuses a module call to the agent's own Safe or a delegatecall, and any module
    /// call while the agent is frozen or removed, unless this contract makes it (an owner power). This is
    /// what stops a user operation the agent's key signs, which the 4337 module runs as a module call: one
    /// the 4337 module validated before a freeze or removal still cannot run after it. `msg.sender` is the
    /// Safe.
    function checkModuleTransaction(
        address to,
        uint256,
        bytes memory,
        uint8 operation,
        address module
    )
        external
        view
        returns (bytes32)
    {
        if (module != address(this)) {
            Agent storage agent = _agents[msg.sender];
            if (agent.frozen || agent.removed) revert AgentInactive(msg.sender);
            _requireNotSelfCall(msg.sender, to, operation);
        }
        return bytes32(0);
    }

    // Neither guard has anything to check after the call runs.
    // forge-lint: disable-next-line(empty-block)
    function checkAfterExecution(bytes32, bool) external pure { }

    // forge-lint: disable-next-line(empty-block)
    function checkAfterModuleExecution(bytes32, bool) external pure { }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(ISafeTransactionGuard).interfaceId
            || interfaceId == type(ISafeModuleGuard).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    /// @notice The agent whose Safe is `safe`; zero owner when there is none.
    function agentOf(address safe) external view returns (Agent memory) {
        return _agents[safe];
    }

    /// @notice The Safe `create(signer, owner)` deploys.
    function safeAddressFor(address signer, address owner) external view returns (address) {
        return _safeAddress(_initializer(), _saltNonce(signer, owner));
    }

    function _requireAgentOwner(address safe) internal view {
        Agent storage agent = _agents[safe];
        if (agent.owner == address(0)) revert UnknownAgent(safe);
        if (msg.sender != agent.owner) revert NotOwner(msg.sender);
        if (agent.removed) revert AgentIsRemoved(safe);
    }

    function _requireNotSelfCall(address safe, address to, uint8 operation) internal pure {
        if (to == safe || operation != CALL) revert AgentSelfCall(safe, to, operation);
    }

    function _requireSigner(address signer, address owner) internal view {
        if (signer == address(0) || signer == SENTINEL_OWNERS || signer == address(this) || signer == owner) {
            revert InvalidSigner();
        }
    }

    // `remove` runs one sweep per token, so the loop lints apply here too; a sweep's event follows its
    // payment, and its calls go only to the token, the agent's Safe and Payments.
    // forge-lint: disable-start(calls-loop, require-revert-in-loop, reentrancy-events, reentrancy-no-eth)
    function _sweep(address safe, address to, address token) internal returns (uint256 amount) {
        if (to == address(0) || to == safe) revert InvalidRecipient();
        amount = IERC20(token).balanceOf(safe);
        if (amount == 0) return 0;
        uint256 count = ++sweeps[safe];
        IPayments.PaymentItem memory item = IPayments.PaymentItem({
            paymentId: bytes32(0),
            recipient: to,
            token: token,
            amount: amount,
            kind: SWEEP_KIND,
            documentHash: keccak256(abi.encode("capxul:agent-sweep:document", safe, to, token, amount, count)),
            jobNonce: keccak256(abi.encode("capxul:agent-sweep", safe, count)),
            executor: safe
        });
        item.paymentId = PAYMENTS.paymentId(item);
        bytes memory approval = _call(safe, token, abi.encodeCall(IERC20.approve, (address(PAYMENTS), amount)));
        if (approval.length != 0 && !abi.decode(approval, (bool))) revert ModuleCallFailed(safe);
        _call(safe, address(PAYMENTS), abi.encodeCall(IPayments.send, (item)));
        emit AgentSwept(safe, to, token, amount);
    }

    function _swapOwner(address safe, address oldOwner, address newOwner) internal {
        _call(safe, safe, abi.encodeCall(ISafeForAgent.swapOwner, (SENTINEL_OWNERS, oldOwner, newOwner)));
    }

    function _call(address safe, address to, bytes memory data) internal returns (bytes memory returnData) {
        bool success;
        (success, returnData) = ISafeForAgent(safe).execTransactionFromModuleReturnData(to, 0, data, 0);
        if (!success) revert ModuleCallFailed(safe);
    }
    // forge-lint: disable-end(calls-loop, require-revert-in-loop, reentrancy-events, reentrancy-no-eth)

    function _saltNonce(address signer, address owner) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(owner, signer)));
    }

    /// @dev The agent's Safe is set up with this contract as its one owner; the salt binds the signer.
    function _initializer() internal view returns (bytes memory) {
        address[] memory modules = new address[](2);
        modules[0] = SAFE_4337_MODULE;
        modules[1] = address(this);
        address[] memory owners = new address[](1);
        owners[0] = address(this);
        return abi.encodeWithSignature(
            "setup(address[],uint256,address,bytes,address,address,uint256,address)",
            owners,
            uint256(1),
            SAFE_MODULE_SETUP,
            abi.encodeCall(ISafeModuleSetupForAgent.enableModules, (modules)),
            SAFE_4337_MODULE,
            address(0),
            uint256(0),
            address(0)
        );
    }

    function _safeAddress(bytes memory initializer, uint256 saltNonce) internal pure returns (address) {
        bytes32 salt = keccak256(abi.encodePacked(keccak256(initializer), saltNonce));
        bytes32 codeHash = keccak256(abi.encodePacked(_proxyCreationCode(), uint256(uint160(SAFE_L2_SINGLETON))));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), SAFE_PROXY_FACTORY, salt, codeHash)))));
    }

    /// @dev `SafeProxyFactory.proxyCreationCode()` for Safe v1.5.0, read from the canonical factory.
    function _proxyCreationCode() internal pure returns (bytes memory) {
        return hex"608060405234801561001057600080fd5b506040516101b63803806101b68339818101604052602081101561003357600080fd5b8101908080519060200190929190505050600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614156100ca576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260228152602001806101946022913960400191505060405180910390fd5b806000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff16021790555050607b806101196000396000f3fe608060405260005463a619486e60003560e01c14156024578060601b606c5260206060f35b3660008037600080366000845af43d6000803e806040573d6000fd5b3d6000f3fea2646970667358221220e61834ebd2d8cd909d362bf67c47ef58fd665df38e6dd036ce65611101d072e964736f6c63430007060033496e76616c69642073696e676c65746f6e20616464726573732070726f7669646564";
    }
}
