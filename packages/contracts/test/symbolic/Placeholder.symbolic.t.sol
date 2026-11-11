// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @notice Gate 10's placeholder. Halmos fails a project that has no `check_` function, so the
/// empty project carries this one. The first contract's real `check_` replaces it.
contract Placeholder_Symbolic {
    function check_noop(uint256 x) public pure {
        assert(x ^ x == 0);
    }
}
