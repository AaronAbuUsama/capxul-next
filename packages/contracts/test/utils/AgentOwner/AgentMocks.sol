// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Vm } from "forge-std/Vm.sol";

/// @dev An agent Safe for hermetic AgentOwner tests: one owner, threshold 1, and the parts of Safe 1.4.1
/// that `setup` and AgentOwner use (as Safe 1.5.0). `setup` delegatecalls its `to` as Safe does; `swapOwner` and
/// `enableModule` accept only the Safe itself, with Safe's checks on the new owner.
contract MockAgentSafe {
    address internal constant SENTINEL_OWNERS = address(0x1);

    address public owner;
    address public fallbackHandler;
    address public guard;
    address public moduleGuard;
    uint256 public threshold;
    mapping(address module => bool) public isModuleEnabled;
    /// @dev When true, module calls report failure without running.
    bool public refusesModuleCalls;

    error AlreadySetUp();
    error OnlySelf();
    error InvalidOwner();
    error InvalidSwap();
    error NotModule(address caller);
    error SetupCallFailed();

    function setup(
        address[] calldata owners,
        uint256 threshold_,
        address to,
        bytes calldata data,
        address fallbackHandler_,
        address,
        uint256,
        address payable
    )
        external
    {
        if (threshold != 0) revert AlreadySetUp();
        if (owners.length != 1 || threshold_ != 1) revert InvalidOwner();
        owner = owners[0];
        threshold = threshold_;
        fallbackHandler = fallbackHandler_;
        if (to != address(0)) {
            (bool ok,) = to.delegatecall(data);
            if (!ok) revert SetupCallFailed();
        }
    }

    function setRefusesModuleCalls(bool refuses) external {
        refusesModuleCalls = refuses;
    }

    function getOwners() external view returns (address[] memory owners) {
        owners = new address[](1);
        owners[0] = owner;
    }

    function enableModule(address module) external {
        if (msg.sender != address(this)) revert OnlySelf();
        isModuleEnabled[module] = true;
    }

    function setGuard(address guard_) external {
        if (msg.sender != address(this)) revert OnlySelf();
        guard = guard_;
    }

    function setModuleGuard(address moduleGuard_) external {
        if (msg.sender != address(this)) revert OnlySelf();
        moduleGuard = moduleGuard_;
    }

    function swapOwner(address prevOwner, address oldOwner, address newOwner) external {
        if (msg.sender != address(this)) revert OnlySelf();
        if (
            newOwner == address(0) || newOwner == SENTINEL_OWNERS || newOwner == address(this) || newOwner == owner
                || prevOwner != SENTINEL_OWNERS || oldOwner != owner
        ) revert InvalidSwap();
        owner = newOwner;
    }

    /// @dev As Safe 1.4.1: reports failure instead of reverting.
    function execTransactionFromModuleReturnData(
        address to,
        uint256 value,
        bytes memory data,
        uint8 operation
    )
        external
        returns (bool success, bytes memory returnData)
    {
        if (!isModuleEnabled[msg.sender]) revert NotModule(msg.sender);
        if (refusesModuleCalls || operation != 0) return (false, "");
        (success, returnData) = to.call{ value: value }(data);
    }
}

/// @dev Etched at SafeModuleSetup: run by delegatecall from `MockAgentSafe.setup`, as the real one is.
contract MockAgentModuleSetup {
    function enableModules(address[] calldata modules) external {
        for (uint256 index; index < modules.length; ++index) {
            MockAgentSafe(address(this)).enableModule(modules[index]);
        }
    }
}

/// @dev Etched at the canonical Safe proxy factory. Records each `createProxyWithNonce`, puts a
/// `MockAgentSafe` at `landing` and calls it with the initializer, bubbling a revert.
contract MockAgentProxyFactory {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address public landing;
    uint256 public calls;
    address public lastSingleton;
    bytes public lastInitializer;
    uint256 public lastSaltNonce;

    function setLanding(address landing_) external {
        landing = landing_;
    }

    function createProxyWithNonce(
        address singleton,
        bytes memory initializer,
        uint256 saltNonce
    )
        external
        returns (address proxy)
    {
        ++calls;
        lastSingleton = singleton;
        lastInitializer = initializer;
        lastSaltNonce = saltNonce;
        proxy = landing;
        VM.etch(proxy, address(new MockAgentSafe()).code);
        (bool ok, bytes memory result) = proxy.call(initializer);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(result, 0x20), mload(result))
            }
        }
    }
}

/// @dev A token whose `approve` returns false, to prove a sweep refuses it.
contract MockFalseApproveToken {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address, uint256) external pure returns (bool) {
        return false;
    }
}
