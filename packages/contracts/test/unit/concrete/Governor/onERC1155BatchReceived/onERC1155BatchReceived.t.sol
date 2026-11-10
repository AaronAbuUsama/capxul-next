// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IGovernor as IOZGovernor } from "@openzeppelin/contracts/governance/IGovernor.sol";

import { MockNFT1155 } from "../../../../utils/Governor/GovernorMocks.sol";
import { Governor_Shared_Test } from "../../../../utils/Governor/Governor_Shared_Test.sol";

/// @dev N-7 (G4), R1 G-9.
contract OnERC1155BatchReceived_Governor_Unit_Concrete_Test is Governor_Shared_Test {
    function test_WhenAnERC1155BatchIsSentToTheGovernor() external {
        // it should revert with GovernorDisabledDeposit
        MockNFT1155 nft = new MockNFT1155();
        nft.mint(users.eve, 1, 5);
        nft.mint(users.eve, 2, 7);
        uint256[] memory ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 2;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 5;
        amounts[1] = 7;
        vm.expectRevert(IOZGovernor.GovernorDisabledDeposit.selector);
        vm.prank(users.eve);
        nft.safeBatchTransferFrom(users.eve, address(governor), ids, amounts, "");
        assertEq(nft.balanceOf(address(governor), 1) + nft.balanceOf(address(governor), 2), 0, "holds none");
        vm.expectRevert(IOZGovernor.GovernorDisabledDeposit.selector);
        governor.onERC1155BatchReceived(users.eve, users.eve, ids, amounts, "");
    }
}
