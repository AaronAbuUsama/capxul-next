// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { MockERC20 } from "./MockERC20.sol";

/// @dev An ERC-20 that calls back into a target from inside a transfer, as an ERC-777 hook would.
/// Generalises beta `packages/contracts/test/mocks/MockReentrantERC20.sol` (which re-entered one
/// beta function from `approve`): the test arms any call, the next transfer makes it once, and
/// the result is kept so the test can assert the re-entry was refused with the expected error.
contract MockReentrantERC20 is MockERC20 {
    address public target;
    bytes public callData;
    bool public reentered;
    bool public reentrySucceeded;
    bytes public reentryResult;

    constructor() MockERC20("Reentrant Token", "REENTER", 6) { }

    /// @dev The next transfer (not mint or burn) calls `target_` with `callData_`, once.
    function arm(address target_, bytes calldata callData_) external {
        target = target_;
        callData = callData_;
    }

    function _update(address from, address to, uint256 value) internal override {
        address armed = target;
        if (armed != address(0) && from != address(0) && to != address(0)) {
            target = address(0);
            reentered = true;
            (reentrySucceeded, reentryResult) = armed.call(callData);
        }
        super._update(from, to, value);
    }
}
