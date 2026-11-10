// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";

import { IShareClass } from "../../../../../src/interfaces/IShareClass.sol";
import { ShareClass_Shared_Test } from "../../../../utils/ShareClass/ShareClass_Shared_Test.sol";

/// @dev Ports Firm EquityToken.t.sol:24-34 (T-1, T-2), with 0 decimals (T-1) and the sealed implementation (N-6).
contract Initialize_ShareClass_Unit_Concrete_Test is ShareClass_Shared_Test {
    function test_WhenItIsTheImplementation() external {
        // it should revert with the initializer error
        vm.expectRevert(INVALID_INITIALIZATION);
        implementation.initialize(NAME, SYMBOL, address(captable), CLASS_ID);
    }

    function test_WhenItWasAlreadyInitialized() external {
        // it should revert with the initializer error
        vm.expectRevert(INVALID_INITIALIZATION);
        vm.prank(users.eve);
        token.initialize("Eve Ltd Common", "EVE", users.eve, 7);
        assertEq(token.captable(), address(captable), "captable kept");
        assertEq(token.classId(), CLASS_ID, "class id kept");
    }

    function test_WhenItIsAFreshClone() external {
        IShareClass fresh = IShareClass(Clones.clone(address(implementation)));
        fresh.initialize(NAME, SYMBOL, address(captable), CLASS_ID);
        // it should set the name and the symbol and the Captable and the class id
        assertEq(fresh.name(), NAME, "name");
        assertEq(fresh.symbol(), SYMBOL, "symbol");
        assertEq(fresh.captable(), address(captable), "captable");
        assertEq(fresh.classId(), CLASS_ID, "class id");
        // it should read and store the Captable's Safe
        assertEq(fresh.safe(), address(safe), "safe");
        // it should report 0 decimals
        assertEq(fresh.decimals(), 0, "decimals");
        assertEq(fresh.totalSupply(), 0, "no supply yet");
    }
}
