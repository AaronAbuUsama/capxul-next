// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IGovernor as IOZGovernor } from "@openzeppelin/contracts/governance/IGovernor.sol";

import { MockNFT721 } from "../../../../utils/Governor/GovernorMocks.sol";
import { Governor_Shared_Test } from "../../../../utils/Governor/Governor_Shared_Test.sol";

/// @dev N-7 (G4), R1 G-9 (Firm OZGovernor.sol:44-78 refused NFTs too).
contract OnERC721Received_Governor_Unit_Concrete_Test is Governor_Shared_Test {
    function test_WhenAnERC721TokenIsSentToTheGovernor() external {
        // it should revert with GovernorDisabledDeposit
        MockNFT721 nft = new MockNFT721();
        nft.mint(users.eve, 1);
        vm.expectRevert(IOZGovernor.GovernorDisabledDeposit.selector);
        vm.prank(users.eve);
        nft.safeTransferFrom(users.eve, address(governor), 1);
        assertEq(nft.ownerOf(1), users.eve, "eve keeps it");
        assertEq(nft.balanceOf(address(governor)), 0, "holds no NFT");
        // A direct call refuses too.
        vm.expectRevert(IOZGovernor.GovernorDisabledDeposit.selector);
        governor.onERC721Received(users.eve, users.eve, 1, "");
    }
}
