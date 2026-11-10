// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Vm } from "forge-std/Vm.sol";

/// @dev A Capxul personal Safe for hermetic claim tests: one owner, threshold 1, and only the parts of
/// Safe 1.4.1 the claimer uses. `execTransaction` accepts only the `v = 1` "caller is the owner"
/// signature and reverts when its call fails, as Safe does with `safeTxGas` and `gasPrice` zero.
contract MockPersonalSafe {
    address internal constant SENTINEL_OWNERS = address(0x1);

    address public owner;
    /// @dev When true, `execTransaction` returns false without running the call.
    bool public refusesSwap;

    error AlreadySetUp();
    error NotOwnerSignature(address caller);
    error OnlySelf();
    error InvalidSwap();
    error CallFailed();

    function setUp(address owner_) external {
        if (owner != address(0)) revert AlreadySetUp();
        owner = owner_;
    }

    function setRefusesSwap(bool refuses) external {
        refusesSwap = refuses;
    }

    function getOwners() external view returns (address[] memory owners) {
        owners = new address[](1);
        owners[0] = owner;
    }

    function getThreshold() external pure returns (uint256) {
        return 1;
    }

    function execTransaction(
        address to,
        uint256,
        bytes calldata data,
        uint8 operation,
        uint256,
        uint256,
        uint256,
        address,
        address payable,
        bytes memory signatures
    )
        external
        payable
        returns (bool)
    {
        bytes memory approved = abi.encodePacked(uint256(uint160(msg.sender)), bytes32(0), uint8(1));
        if (msg.sender != owner || keccak256(signatures) != keccak256(approved)) {
            revert NotOwnerSignature(msg.sender);
        }
        if (refusesSwap) return false;
        if (operation != 0) revert CallFailed();
        (bool ok,) = to.call(data);
        if (!ok) revert CallFailed();
        return true;
    }

    function swapOwner(address prevOwner, address oldOwner, address newOwner) external {
        if (msg.sender != address(this)) revert OnlySelf();
        if (prevOwner != SENTINEL_OWNERS || oldOwner != owner || newOwner == address(0)) revert InvalidSwap();
        owner = newOwner;
    }
}

/// @dev Etched at the canonical Safe proxy factory. Records each `createProxyWithNonce` and puts a
/// `MockPersonalSafe` owned by the caller at `landing`, the address the test says the proxy lands at.
contract MockClaimProxyFactory {
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
        VM.etch(proxy, address(new MockPersonalSafe()).code);
        MockPersonalSafe(proxy).setUp(msg.sender);
    }
}

/// @dev Companies House reduced to what its Roles role does: delegatecall the claimer, bubbling a revert.
contract MockCompaniesHouse {
    function claimThrough(
        address claimer,
        string calldata namespace,
        string calldata email,
        address signer
    )
        external
        returns (address safe)
    {
        (bool ok, bytes memory result) =
            claimer.delegatecall(abi.encodeWithSignature("claim(string,string,address)", namespace, email, signer));
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(result, 0x20), mload(result))
            }
        }
        safe = abi.decode(result, (address));
    }
}
