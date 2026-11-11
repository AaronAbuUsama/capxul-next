// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";

import { Rounds } from "../../../../src/equity/Rounds.sol";
import { IRounds } from "../../../../src/interfaces/IRounds.sol";
import { Rounds_Shared_Test } from "../../../utils/Rounds/Rounds_Shared_Test.sol";

/// @dev Invariant I3 (no upgrade path; the implementation cannot be initialised) over any wiring and caller, and
/// a clone initialises once: its wiring is what the first call gave.
contract Initialize_Rounds_Unit_Fuzz_Test is Rounds_Shared_Test {
    function testFuzz_Initialize_ImplementationSealed(address caller, address s, address c, address p) external {
        vm.expectRevert(IRounds.AlreadyInitialized.selector);
        vm.prank(caller);
        implementation.initialize(s, c, p);
    }

    function testFuzz_Initialize_CloneOnce(address s, address c, address p) external {
        vm.assume(s != address(0) && c != address(0) && p != address(0));
        Rounds clone = Rounds(Clones.clone(address(implementation)));
        clone.initialize(s, c, p);
        assertEq(clone.safe(), s, "safe");
        assertEq(clone.captable(), c, "captable");
        assertEq(clone.payments(), p, "payments");
        vm.expectRevert(IRounds.AlreadyInitialized.selector);
        vm.prank(s);
        clone.initialize(address(1), address(1), address(1));
        // The shared clone was wired in setUp.
        assertEq(rounds.safe(), address(safe), "wired safe");
    }
}
