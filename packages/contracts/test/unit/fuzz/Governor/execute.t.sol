// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IGovernor } from "../../../../src/interfaces/IGovernor.sol";
import { Governor_Shared_Test } from "../../../utils/Governor/Governor_Shared_Test.sol";

/// @dev The execute tree's ranged leaf: any ether sent with `execute` is refused (N-7, G4).
contract Execute_Governor_Unit_Fuzz_Test is Governor_Shared_Test {
    function testFuzz_RevertWhen_EtherIsSentWithTheCall(address caller, uint256 value) external {
        vm.assume(caller != address(0) && caller != address(governor));
        value = bound(value, 1, 1_000_000 ether);
        bytes memory data = abi.encodeCall(targetA.setNumber, (1));
        uint256 id = _propose(address(targetA), data, "fuzz execute");
        _pass(id);
        vm.deal(caller, value);
        vm.expectRevert(IGovernor.ValueNotAllowed.selector);
        vm.prank(caller);
        governor.execute{ value: value }(
            _one(address(targetA)), _one(uint256(0)), _one(data), keccak256(bytes("fuzz execute"))
        );
        assertEq(address(governor).balance, 0, "holds no ether");
    }
}
