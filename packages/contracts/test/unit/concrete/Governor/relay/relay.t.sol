// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IGovernor } from "../../../../../src/interfaces/IGovernor.sol";
import { Governor_Shared_Test } from "../../../../utils/Governor/Governor_Shared_Test.sol";

/// @dev OpenZeppelin's escape hatch is disabled (spec "Rules", G1): not for anyone, not for the Safe, not for
/// the Governor itself in a passed proposal.
contract Relay_Governor_Unit_Concrete_Test is Governor_Shared_Test {
    function test_ShouldAlwaysRevert() external {
        // it should always revert
        bytes memory data = abi.encodeCall(targetA.setNumber, (9));
        vm.expectRevert(IGovernor.RelayDisabled.selector);
        vm.prank(users.eve);
        governor.relay(address(targetA), 0, data);

        vm.expectRevert(IGovernor.RelayDisabled.selector);
        vm.prank(address(safe));
        governor.relay(address(safe), 0, "");

        vm.expectRevert(IGovernor.RelayDisabled.selector);
        vm.prank(address(governor));
        governor.relay(address(targetA), 0, data);

        // A passed proposal that relays fails as a whole.
        bytes memory relayCall = abi.encodeCall(governor.relay, (address(targetA), 0, data));
        uint256 id = _propose(address(governor), relayCall, "relay");
        _pass(id);
        vm.expectRevert(IGovernor.RelayDisabled.selector);
        _execute(address(governor), relayCall, "relay");
        assertEq(targetA.calls(), 0, "target never reached");
    }
}
