// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IGovernor as IOZGovernor } from "@openzeppelin/contracts/governance/IGovernor.sol";

import { Governor_Shared_Test } from "../../../../utils/Governor/Governor_Shared_Test.sol";

/// @dev N-7 (G4): with no timelock OpenZeppelin 5 would accept ether; the Governor refuses it.
contract Receive_Governor_Unit_Concrete_Test is Governor_Shared_Test {
    function test_WhenEtherIsSentToTheGovernor() external {
        // it should revert with GovernorDisabledDeposit
        vm.prank(users.eve);
        (bool ok, bytes memory ret) = address(governor).call{ value: 1 ether }("");
        assertFalse(ok, "accepted");
        assertEq(ret, abi.encodeWithSelector(IOZGovernor.GovernorDisabledDeposit.selector), "error");
        assertEq(address(governor).balance, 0, "holds no ether");
        // The Safe cannot fund it either.
        vm.deal(address(safe), 1 ether);
        vm.prank(address(safe));
        (ok, ret) = address(governor).call{ value: 1 }("");
        assertFalse(ok, "accepted from the Safe");
        assertEq(ret, abi.encodeWithSelector(IOZGovernor.GovernorDisabledDeposit.selector), "error from the Safe");
    }
}
