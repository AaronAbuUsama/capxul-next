// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @notice The parts of the third-party contracts the fork tests call. Signatures from Safe 1.4.1,
/// Zodiac Roles v2, Hats Protocol v1 and Hats Signer Gate v2 (R3 section 3). Operations are uint8:
/// 0 = call, 1 = delegatecall.

interface ISafe {
    function setup(
        address[] calldata owners,
        uint256 threshold,
        address to,
        bytes calldata data,
        address fallbackHandler,
        address paymentToken,
        uint256 payment,
        address payable paymentReceiver
    )
        external;
    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures
    )
        external
        payable
        returns (bool);
    function getTransactionHash(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address refundReceiver,
        uint256 nonce
    )
        external
        view
        returns (bytes32);
    function approveHash(bytes32 hashToApprove) external;
    function nonce() external view returns (uint256);
    function getOwners() external view returns (address[] memory);
    function getThreshold() external view returns (uint256);
    function isOwner(address owner) external view returns (bool);
    function enableModule(address module) external;
    function setGuard(address guard) external;
    function isModuleEnabled(address module) external view returns (bool);
    function getModulesPaginated(
        address start,
        uint256 pageSize
    )
        external
        view
        returns (address[] memory array, address next);
}

interface ISafeProxyFactory {
    function createProxyWithNonce(
        address singleton,
        bytes memory initializer,
        uint256 saltNonce
    )
        external
        returns (address proxy);
}

interface IModuleProxyFactory {
    function deployModule(
        address masterCopy,
        bytes memory initializer,
        uint256 saltNonce
    )
        external
        returns (address proxy);
}

interface IRoles {
    function setUp(bytes memory initParams) external;
    function avatar() external view returns (address);
    function target() external view returns (address);
    function setTarget(address target) external;
    function scopeTarget(bytes32 roleKey, address targetAddress) external;
    /// @param options ExecutionOptions: 0 none, 1 send, 2 delegatecall, 3 both.
    function allowFunction(bytes32 roleKey, address targetAddress, bytes4 selector, uint8 options) external;
    function assignRoles(address module, bytes32[] calldata roleKeys, bool[] calldata memberOf) external;
    function execTransactionWithRole(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        bytes32 roleKey,
        bool shouldRevert
    )
        external
        returns (bool success);
    /// @dev As `execTransactionWithRole`, but returns the call's return or revert data.
    function execTransactionWithRoleReturnData(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        bytes32 roleKey,
        bool shouldRevert
    )
        external
        returns (bool success, bytes memory returnData);
}

/// @dev Roles 2.1 scoping, which the shared `IRoles` does not declare.
interface IRolesScoping {
    struct ConditionFlat {
        uint8 parent;
        uint8 paramType;
        uint8 operator;
        bytes compValue;
    }

    /// @param options ExecutionOptions: 0 none, 1 send, 2 delegatecall, 3 both.
    function scopeFunction(
        bytes32 roleKey,
        address targetAddress,
        bytes4 selector,
        ConditionFlat[] memory conditions,
        uint8 options
    )
        external;
}

interface IHats {
    function mintTopHat(
        address target,
        string calldata details,
        string calldata imageURI
    )
        external
        returns (uint256 topHatId);
    function createHat(
        uint256 admin,
        string calldata details,
        uint32 maxSupply,
        address eligibility,
        address toggle,
        bool mutable_,
        string calldata imageURI
    )
        external
        returns (uint256 newHatId);
    function mintHat(uint256 hatId, address wearer) external returns (bool);
    function setHatWearerStatus(uint256 hatId, address wearer, bool eligible, bool standing) external returns (bool);
    function isWearerOfHat(address account, uint256 hatId) external view returns (bool);
}

interface IHatsSignerGate {
    enum TargetThresholdType {
        ABSOLUTE,
        PROPORTIONAL
    }

    struct ThresholdConfig {
        TargetThresholdType thresholdType;
        uint120 min;
        uint120 target;
    }

    struct SetupParams {
        uint256 ownerHat;
        uint256[] signerHats;
        address safe;
        ThresholdConfig thresholdConfig;
        bool locked;
        bool claimableFor;
        address implementation;
        address hsgGuard;
        address[] hsgModules;
    }

    error InsufficientValidSignatures();
    error CannotChangeModules();
    error CannotCallSafe();

    event ExecutionFromModuleSuccess(address indexed module);

    function setUp(bytes calldata initializeParams) external payable;
    function claimSigner(uint256 hatId) external;
    function isValidSigner(address account) external view returns (bool);
    function isModuleEnabled(address module) external view returns (bool);
    function safe() external view returns (address);
}
