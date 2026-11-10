// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @dev A company Safe for hermetic tests. Enabled modules make plain calls as the Safe; the owner
/// (the test) runs install batches with `execute`. No signatures, guard or delegatecall: those are
/// tested on the fork against the real Safe 1.4.1 and Hats Signer Gate.
contract MockSafe {
    struct Call {
        address to;
        uint256 value;
        bytes data;
    }

    error NotOwner(address caller);
    error NotModule(address caller);
    error DelegatecallNotSupported();
    error CallFailed(uint256 index, bytes reason);

    event ExecutionFromModuleSuccess(address indexed module);
    event ExecutionFromModuleFailure(address indexed module);

    address public immutable owner;
    mapping(address module => bool) public isModuleEnabled;

    constructor(address owner_) {
        owner = owner_;
    }

    receive() external payable { }

    function isOwner(address account) external view returns (bool) {
        return account == owner;
    }

    function enableModule(address module) external {
        if (msg.sender != owner && msg.sender != address(this)) revert NotOwner(msg.sender);
        isModuleEnabled[module] = true;
    }

    function disableModule(address module) external {
        if (msg.sender != owner && msg.sender != address(this)) revert NotOwner(msg.sender);
        isModuleEnabled[module] = false;
    }

    /// @dev As Safe 1.4.1: reports failure instead of reverting.
    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation
    )
        external
        returns (bool success)
    {
        if (!isModuleEnabled[msg.sender]) revert NotModule(msg.sender);
        if (operation != 0) revert DelegatecallNotSupported();
        (success,) = to.call{ value: value }(data);
        if (success) emit ExecutionFromModuleSuccess(msg.sender);
        else emit ExecutionFromModuleFailure(msg.sender);
    }

    /// @dev An install batch, all or nothing.
    function execute(Call[] calldata calls) external {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        for (uint256 i; i < calls.length; ++i) {
            (bool ok, bytes memory reason) = calls[i].to.call{ value: calls[i].value }(calls[i].data);
            if (!ok) revert CallFailed(i, reason);
        }
    }
}
