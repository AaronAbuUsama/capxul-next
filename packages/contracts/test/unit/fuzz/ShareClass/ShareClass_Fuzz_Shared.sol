// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { ShareClass_Shared_Test } from "../../../utils/ShareClass/ShareClass_Shared_Test.sol";

/// @dev Input shaping for the ShareClass fuzz tests. Amounts are what the Captable issues (`uint128`, at
/// least 1); a fuzzed account is any address but zero and the contracts under test.
abstract contract ShareClass_Fuzz_Shared is ShareClass_Shared_Test {
    function _account(address a) internal view returns (address) {
        vm.assume(a != address(0) && a != address(token) && a != address(captable) && a != address(implementation));
        return a;
    }

    function _holder(address a) internal view returns (address) {
        a = _account(a);
        vm.assume(a != address(safe));
        return a;
    }

    function _amount(uint256 amount) internal pure returns (uint256) {
        return bound(amount, 1, type(uint128).max);
    }
}
