// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { MockSafe } from "./MockSafe.sol";

/// @dev Zodiac Roles v2 for hermetic tests: a member of a role may call the role's allowed targets,
/// and an ERC-20 `transfer` on a target with an allowance spends it. The call then goes through
/// `MockSafe.execTransactionFromModule`, so the Safe makes it. The real conditions and allowance
/// refills are tested on the fork.
contract MockRoles {
    error NotAuthorized(address module);
    error TargetNotAllowed(bytes32 roleKey, address target);
    error AllowanceExceeded(bytes32 roleKey, address token, uint256 amount, uint256 left);
    error ModuleTransactionFailed();

    MockSafe public immutable avatar;
    mapping(bytes32 roleKey => mapping(address member => bool)) public isMember;
    mapping(bytes32 roleKey => mapping(address target => bool)) public isAllowed;
    /// @dev type(uint256).max means no allowance applies.
    mapping(bytes32 roleKey => mapping(address token => uint256)) public allowance;

    constructor(MockSafe avatar_) {
        avatar = avatar_;
    }

    // Test setters: the real Roles takes these from its owner, the Safe.
    function setMember(bytes32 roleKey, address member, bool on) external {
        isMember[roleKey][member] = on;
    }

    function allowTarget(bytes32 roleKey, address target, bool on) external {
        isAllowed[roleKey][target] = on;
    }

    function setAllowance(bytes32 roleKey, address token, uint256 amount) external {
        allowance[roleKey][token] = amount;
    }

    function execTransactionWithRole(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        bytes32 roleKey,
        bool shouldRevert
    )
        external
        returns (bool success)
    {
        if (!isMember[roleKey][msg.sender]) revert NotAuthorized(msg.sender);
        if (!isAllowed[roleKey][to]) revert TargetNotAllowed(roleKey, to);
        if (data.length >= 68 && bytes4(data) == bytes4(keccak256("transfer(address,uint256)"))) {
            uint256 left = allowance[roleKey][to];
            (, uint256 amount) = abi.decode(data[4:], (address, uint256));
            if (left != type(uint256).max) {
                if (amount > left) revert AllowanceExceeded(roleKey, to, amount, left);
                allowance[roleKey][to] = left - amount;
            }
        }
        success = avatar.execTransactionFromModule(to, value, data, operation);
        if (shouldRevert && !success) revert ModuleTransactionFailed();
    }
}
