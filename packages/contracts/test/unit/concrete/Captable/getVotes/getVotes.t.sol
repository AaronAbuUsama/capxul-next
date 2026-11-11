// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Captable_Test } from "../../../../utils/Captable/Captable_Test.sol";

contract GetVotes_Captable_Unit_Concrete_Test is Captable_Test {
    function test_WhenAClassHasNoVotingWeight() external {
        // it should exclude that class from the shareholder's votes
        uint8 nonVoting = _createClass(_params(0, 1000, 0, 0));
        _issue(COMMON, users.amira, 10);
        _issue(nonVoting, users.amira, 100);
        assertEq(captable.getVotes(users.amira), 10, "only voting shares count");
    }
}
