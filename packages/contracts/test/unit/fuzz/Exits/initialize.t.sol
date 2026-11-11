// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";

import { IExits } from "../../../../src/interfaces/IExits.sol";
import { Exits_Test } from "../../../utils/Exits/Exits_Test.sol";

/// @dev Invariant I3 for Exits (R1 N-6, "one unit per implementation"): the implementation cannot be
/// initialised by anyone with any wiring, a clone only once, and never with a zero address.
contract Initialize_Exits_Unit_Fuzz_Test is Exits_Test {
    function testFuzz_I3_ImplementationCannotBeInitialised(address caller, address[7] memory w) external {
        vm.expectRevert(IExits.AlreadyInitialized.selector);
        vm.prank(caller);
        implementation.initialize(w[0], w[1], w[2], w[3], w[4], w[5], w[6]);
    }

    function testFuzz_I3_CloneInitialisesOnce(address caller, address[7] memory w) external {
        for (uint256 i; i < 7; ++i) {
            vm.assume(w[i] != address(0));
        }
        IExits ex = IExits(Clones.clone(address(implementation)));
        vm.prank(caller);
        ex.initialize(w[0], w[1], w[2], w[3], w[4], w[5], w[6]);
        vm.expectRevert(IExits.AlreadyInitialized.selector);
        vm.prank(caller);
        ex.initialize(w[0], w[1], w[2], w[3], w[4], w[5], w[6]);
    }

    function testFuzz_ZeroWiringRefused(uint8 which, address[7] memory w) external {
        for (uint256 i; i < 7; ++i) {
            vm.assume(w[i] != address(0));
        }
        w[bound(which, 0, 6)] = address(0);
        IExits ex = IExits(Clones.clone(address(implementation)));
        vm.expectRevert(IExits.ZeroAddress.selector);
        ex.initialize(w[0], w[1], w[2], w[3], w[4], w[5], w[6]);
    }
}
