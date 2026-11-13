// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @dev An escrow owner or authority for the fail-closed reads (D11 and the authority term). It answers every
/// call, `isOwner` and `authorised` included, with exactly the bytes it was given (any length, empty too), or
/// reverts with them. A contract that has neither function but a silent fallback is this target with empty bytes.
contract RawAnswerTarget {
    bytes internal _answer;
    bool internal _reverts;

    function set(bytes calldata answer, bool reverts) external {
        _answer = answer;
        _reverts = reverts;
    }

    fallback() external {
        bytes memory a = _answer;
        bool r = _reverts;
        assembly ("memory-safe") {
            if r { revert(add(a, 32), mload(a)) }
            return(add(a, 32), mload(a))
        }
    }
}
