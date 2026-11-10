// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @dev A payee for D11's fail-closed read that answers every call, `isOwner` included, with exactly the
/// bytes it was given (any length, empty too), or reverts with them. A contract that has no `isOwner` but a
/// silent fallback is this payee with empty bytes.
contract RawAnswerPayee {
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
