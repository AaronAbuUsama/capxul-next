// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @title IRoles
/// @notice The parts of Zodiac Roles v2.1 (mastercopy 0xF2964CE6161ce0e75964Fe7927cE114cb0B283D5) that the protocol
/// calls. Types and signatures checked against the source verified on Base Sepolia Blockscout
/// (gnosisguild/zodiac-modifier-roles, `contracts/Types.sol`, `PermissionBuilder.sol`, `Roles.sol`).
/// `operation` is the Zodiac `Enum.Operation` as a uint8: 0 = call, 1 = delegatecall.
interface IRoles {
    enum ParameterType {
        None,
        Static,
        Dynamic,
        Tuple,
        Array,
        Calldata,
        AbiEncoded
    }

    /// @dev The numbering must match Roles' own, placeholders included.
    enum Operator {
        Pass, // 0
        And,
        Or,
        Nor,
        _Placeholder04,
        Matches, // 5
        ArraySome,
        ArrayEvery,
        ArraySubset,
        _Placeholder09,
        _Placeholder10,
        _Placeholder11,
        _Placeholder12,
        _Placeholder13,
        _Placeholder14,
        EqualToAvatar, // 15
        EqualTo,
        GreaterThan,
        LessThan,
        SignedIntGreaterThan,
        SignedIntLessThan,
        Bitmask,
        Custom,
        _Placeholder23,
        _Placeholder24,
        _Placeholder25,
        _Placeholder26,
        _Placeholder27,
        WithinAllowance, // 28
        EtherWithinAllowance,
        CallWithinAllowance,
        _Placeholder31
    }

    enum ExecutionOptions {
        None,
        Send,
        DelegateCall,
        Both
    }

    /// @notice One node of a condition tree, flattened breadth first; `parent` is the index of its parent node
    /// (the root is its own parent, 0).
    struct ConditionFlat {
        uint8 parent;
        ParameterType paramType;
        Operator operator;
        bytes compValue;
    }

    /// @notice Initialises a proxy. ModuleProxyFactory calls it with `abi.encode(owner, avatar, target)`.
    /// @param initParams `abi.encode(address owner, address avatar, address target)`.
    function setUp(bytes memory initParams) external;

    /// @notice The owner, who configures roles (the company Safe).
    /// @return The owner.
    function owner() external view returns (address);

    /// @notice The account whose assets the module controls (the company Safe).
    /// @return The avatar.
    function avatar() external view returns (address);

    /// @notice The contract the module sends transactions through (the Gate, once the install batch has run).
    /// @return The target.
    function target() external view returns (address);

    /// @notice Sets the target. Owner only.
    /// @param target The new target.
    function setTarget(address target) external;

    /// @notice Adds `module` to, or removes it from, each role. Owner only. Also enables `module` on Roles.
    /// @param module The member.
    /// @param roleKeys The roles.
    /// @param memberOf For each role, true to add and false to remove.
    function assignRoles(address module, bytes32[] calldata roleKeys, bool[] calldata memberOf) external;

    /// @notice Lets the role call only the functions of `targetAddress` that are scoped one by one. Owner only.
    /// @param roleKey The role.
    /// @param targetAddress The target.
    function scopeTarget(bytes32 roleKey, address targetAddress) external;

    /// @notice Lets the role call one function of a target under the given conditions. Owner only.
    /// @param roleKey The role.
    /// @param targetAddress The target.
    /// @param selector The function selector.
    /// @param conditions The condition tree, flattened.
    /// @param options Whether the call may send ETH and/or delegatecall.
    function scopeFunction(
        bytes32 roleKey,
        address targetAddress,
        bytes4 selector,
        ConditionFlat[] memory conditions,
        ExecutionOptions options
    )
        external;

    /// @notice Sets an allowance that `WithinAllowance` conditions spend. Owner only. A zero `maxRefill` means
    /// no maximum; a zero `timestamp` means now.
    /// @param key The allowance key.
    /// @param balance The balance now.
    /// @param maxRefill The most a refill can raise the balance to.
    /// @param refill The amount added each period.
    /// @param period The refill period in seconds (0 for no refill).
    /// @param timestamp When the current period started.
    function setAllowance(
        bytes32 key,
        uint128 balance,
        uint128 maxRefill,
        uint128 refill,
        uint64 period,
        uint64 timestamp
    )
        external;

    /// @notice Sends a transaction through the target as a member of `roleKey`, if the role allows it.
    /// @param to The destination.
    /// @param value The ETH value.
    /// @param data The call data.
    /// @param operation 0 = call, 1 = delegatecall.
    /// @param roleKey The role the caller acts under.
    /// @param shouldRevert Whether to revert when the inner call fails.
    /// @return success Whether the inner call succeeded.
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
}
