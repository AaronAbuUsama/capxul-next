// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";

import { IExits } from "../../../../../src/interfaces/IExits.sol";
import { Exits_Test } from "../../../../utils/Exits/Exits_Test.sol";

contract Initialize_Exits_Unit_Concrete_Test is Exits_Test {
    function test_WhenTheImplementationOrCloneIsAlreadyInitialized() external {
        // it should reject a second initialization
        vm.expectRevert(IExits.AlreadyInitialized.selector);
        implementation.initialize(
            address(safe),
            address(captable),
            address(options),
            address(vesting),
            address(payments),
            governor,
            address(factory)
        );
        vm.expectRevert(IExits.AlreadyInitialized.selector);
        exits.initialize(
            address(safe),
            address(captable),
            address(options),
            address(vesting),
            address(payments),
            governor,
            address(factory)
        );
    }

    function test_WhenAnyDependencyIsZero() external {
        // it should reject the initialization and leave the clone available
        address[7] memory deps = [
            address(safe),
            address(captable),
            address(options),
            address(vesting),
            address(payments),
            governor,
            address(factory)
        ];
        for (uint256 i; i < deps.length; ++i) {
            IExits clone = IExits(Clones.clone(address(implementation)));
            address original = deps[i];
            deps[i] = address(0);
            vm.expectRevert(IExits.ZeroAddress.selector);
            clone.initialize(deps[0], deps[1], deps[2], deps[3], deps[4], deps[5], deps[6]);
            deps[i] = original;
            clone.initialize(deps[0], deps[1], deps[2], deps[3], deps[4], deps[5], deps[6]);
        }
    }
}
