// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IEntryPoint, IPaymaster, PackedUserOperation } from "@openzeppelin/contracts/interfaces/draft-IERC4337.sol";

/// @dev The devnet's mock paymaster (component bundler-paymaster, decision thin-line.bundler): it sponsors every
/// UserOperation from its EntryPoint deposit, with no signature and no storage, so the thin line's canary world sends
/// real sponsored UserOperations. Never deployed outside a devnet.
contract MockPaymaster is IPaymaster {
    IEntryPoint public immutable entryPoint;

    constructor(IEntryPoint entryPoint_) {
        entryPoint = entryPoint_;
    }

    function validatePaymasterUserOp(PackedUserOperation calldata, bytes32, uint256)
        external
        view
        returns (bytes memory context, uint256 validationData)
    {
        require(msg.sender == address(entryPoint), "MockPaymaster: not the EntryPoint");
        return ("", 0);
    }

    function postOp(PostOpMode, bytes calldata, uint256, uint256) external view {
        require(msg.sender == address(entryPoint), "MockPaymaster: not the EntryPoint");
    }

    /// @dev Funds the deposit the EntryPoint charges sponsored operations to.
    function deposit() external payable {
        entryPoint.depositTo{ value: msg.value }(address(this));
    }
}
