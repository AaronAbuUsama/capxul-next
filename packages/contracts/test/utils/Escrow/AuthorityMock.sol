// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @dev An escrow's refund authority, shaped like v4 Budgets' `authorised(uint256 id, address who)`. It admits
/// whoever `admit` set for a key, and can be told to revert or to answer short, long or with any word, so the
/// escrow's fail-closed read of the authority can be tested. `admit` and `remove` change the answer at once, as a
/// hat moving between wearers does.
contract AuthorityMock {
    enum Answer {
        Honest,
        Revert,
        Short, // 31 bytes
        Long, // 64 bytes
        Word // `word`, exactly 32 bytes
    }

    Answer public answer;
    uint256 public word;
    mapping(uint256 key => mapping(address who => bool)) public admitted;

    function setAnswer(Answer answer_, uint256 word_) external {
        answer = answer_;
        word = word_;
    }

    function admit(uint256 key, address who) external {
        admitted[key][who] = true;
    }

    function remove(uint256 key, address who) external {
        admitted[key][who] = false;
    }

    function authorised(uint256 key, address who) external view returns (bool) {
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
                mstore(0, 1)
                mstore(32, 1)
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
        return admitted[key][who];
    }
}
