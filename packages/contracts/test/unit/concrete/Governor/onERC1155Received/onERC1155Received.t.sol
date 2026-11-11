// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IGovernor as IOZGovernor } from "@openzeppelin/contracts/governance/IGovernor.sol";

import { MockNFT1155 } from "../../../../utils/Governor/GovernorMocks.sol";
import { Governor_Shared_Test } from "../../../../utils/Governor/Governor_Shared_Test.sol";

/// @dev N-7 (G4), R1 G-9.
contract OnERC1155Received_Governor_Unit_Concrete_Test is Governor_Shared_Test {
    function test_WhenAnERC1155TokenIsSentToTheGovernor() external {
        // it should revert with GovernorDisabledDeposit
        MockNFT1155 nft = new MockNFT1155();
        nft.mint(users.eve, 1, 5);
        vm.expectRevert(IOZGovernor.GovernorDisabledDeposit.selector);
        vm.prank(users.eve);
        nft.safeTransferFrom(users.eve, address(governor), 1, 5, "");
        assertEq(nft.balanceOf(address(governor), 1), 0, "holds none");
        assertEq(nft.balanceOf(users.eve, 1), 5, "eve keeps them");
        vm.expectRevert(IOZGovernor.GovernorDisabledDeposit.selector);
        governor.onERC1155Received(users.eve, users.eve, 1, 5, "");
    }
}
