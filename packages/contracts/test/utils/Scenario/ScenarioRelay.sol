// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @notice Forwards a permissionless call (an `anyone` event such as `Installer.deployMoney`) and keeps
/// what it returned, so later events can name its results (the hats, Roles, the Gate, the equity clones).
/// The TypeScript player keeps the same results from the call's dry run.
contract ScenarioRelay {
    /// @dev keccak256(abi.encode(target, selector)) => the last call's return data.
    mapping(bytes32 key => bytes returned) internal _results;

    /// @notice Calls `target` with `data`; bubbles a revert unchanged, else records the return data.
    /// @param target The contract.
    /// @param data The calldata.
    /// @return returned What the call returned.
    function relay(address target, bytes calldata data) external returns (bytes memory returned) {
        bool ok;
        (ok, returned) = target.call(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(returned, 32), mload(returned))
            }
        }
        _results[keccak256(abi.encode(target, bytes4(data)))] = returned;
    }

    /// @notice What the last relayed call to `target` with `selector` returned; empty if none.
    /// @param target The contract.
    /// @param selector The function.
    /// @return The return data.
    function result(address target, bytes4 selector) external view returns (bytes memory) {
        return _results[keccak256(abi.encode(target, selector))];
    }
}
