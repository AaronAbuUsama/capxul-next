// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @dev A payee Safe for D11. It answers `isOwner(address)` from an owner list, or, when told, with a
/// revert, a short or long answer, or any 32-byte word, so the escrow's fail-closed read can be tested.
/// `claim` swaps Companies House out, as the claimer does on chain; `addOwner` adds a recovery key.
contract PayeeSafeMock {
    enum Answer {
        Owners, // the honest answer from `owners`
        Revert,
        Short, // 31 bytes
        Long, // 64 bytes
        Word // `word`, exactly 32 bytes
    }

    Answer public answer;
    uint256 public word;
    address[] internal _owners;

    constructor(address[] memory owners_) {
        _owners = owners_;
    }

    function getOwners() external view returns (address[] memory) {
        return _owners;
    }

    function setAnswer(Answer answer_, uint256 word_) external {
        answer = answer_;
        word = word_;
    }

    function addOwner(address owner) external {
        _owners.push(owner);
    }

    /// @dev Replaces `from` with `to` wherever it appears.
    function swapOwner(address from, address to) external {
        for (uint256 i; i < _owners.length; ++i) {
            if (_owners[i] == from) _owners[i] = to;
        }
    }

    function isOwner(address account) external view returns (bool) {
        Answer a = answer;
        if (a == Answer.Revert) revert("no");
        if (a == Answer.Short) {
            assembly ("memory-safe") {
                mstore(0, 0)
                return(0, 31)
            }
        }
        if (a == Answer.Long) {
            assembly ("memory-safe") {
                mstore(0, 0)
                mstore(32, 0)
                return(0, 64)
            }
        }
        if (a == Answer.Word) {
            uint256 w = word;
            assembly ("memory-safe") {
                mstore(0, w)
                return(0, 32)
            }
        }
        for (uint256 i; i < _owners.length; ++i) {
            if (_owners[i] == account) return true;
        }
        return false;
    }
}
