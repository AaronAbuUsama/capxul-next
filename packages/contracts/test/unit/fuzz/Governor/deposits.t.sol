// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IGovernor as IOZGovernor } from "@openzeppelin/contracts/governance/IGovernor.sol";

import { MockNFT1155, MockNFT721 } from "../../../utils/Governor/GovernorMocks.sol";
import { Governor_Shared_Test } from "../../../utils/Governor/Governor_Shared_Test.sol";

/// @dev The receive and NFT hook trees' ranged leaves: any sender, any amount, any token id (N-7, G4).
contract Deposits_Governor_Unit_Fuzz_Test is Governor_Shared_Test {
    function testFuzz_RevertWhen_EtherIsSentToTheGovernor(address sender, uint256 value) external {
        vm.assume(sender != address(governor));
        value = bound(value, 1, 1_000_000 ether);
        vm.deal(sender, value);
        vm.prank(sender);
        (bool ok, bytes memory ret) = address(governor).call{ value: value }("");
        assertFalse(ok, "accepted");
        assertEq(ret, abi.encodeWithSelector(IOZGovernor.GovernorDisabledDeposit.selector), "error");
        assertEq(address(governor).balance, 0, "holds no ether");
    }

    function testFuzz_RevertWhen_AnERC721TokenIsSentToTheGovernor(uint256 tokenId) external {
        MockNFT721 nft = new MockNFT721();
        nft.mint(users.eve, tokenId);
        vm.expectRevert(IOZGovernor.GovernorDisabledDeposit.selector);
        vm.prank(users.eve);
        nft.safeTransferFrom(users.eve, address(governor), tokenId);
        assertEq(nft.balanceOf(address(governor)), 0, "holds no NFT");
    }

    function testFuzz_RevertWhen_AnERC1155TokenIsSentToTheGovernor(uint256 id, uint256 amount) external {
        amount = bound(amount, 1, type(uint128).max);
        MockNFT1155 nft = new MockNFT1155();
        nft.mint(users.eve, id, amount);
        vm.expectRevert(IOZGovernor.GovernorDisabledDeposit.selector);
        vm.prank(users.eve);
        nft.safeTransferFrom(users.eve, address(governor), id, amount, "");
        assertEq(nft.balanceOf(address(governor), id), 0, "holds none");
    }

    function testFuzz_RevertWhen_AnERC1155BatchIsSentToTheGovernor(uint256 id, uint256 amount) external {
        amount = bound(amount, 1, type(uint128).max);
        id = bound(id, 0, type(uint256).max - 1);
        MockNFT1155 nft = new MockNFT1155();
        nft.mint(users.eve, id, amount);
        nft.mint(users.eve, id + 1, amount);
        uint256[] memory ids = new uint256[](2);
        ids[0] = id;
        ids[1] = id + 1;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = amount;
        amounts[1] = amount;
        vm.expectRevert(IOZGovernor.GovernorDisabledDeposit.selector);
        vm.prank(users.eve);
        nft.safeBatchTransferFrom(users.eve, address(governor), ids, amounts, "");
        assertEq(nft.balanceOf(address(governor), id), 0, "holds none");
    }
}
