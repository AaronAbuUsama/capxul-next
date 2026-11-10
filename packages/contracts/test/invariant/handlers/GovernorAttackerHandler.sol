// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IERC5805 } from "@openzeppelin/contracts/interfaces/IERC5805.sol";
import { Test } from "forge-std/Test.sol";

import { Governor } from "../../../src/equity/Governor.sol";
import { MockNFT1155, MockNFT721 } from "../../utils/Governor/GovernorMocks.sol";

/// @notice Eve (who holds nothing and wears nothing), a shareholder's account Eve has taken over (Amira's,
/// to get past the threshold), and the Board (the company Safe) trying everything the Governor must refuse:
/// deposits of ether and NFTs (G4), proposals to the Safe, to Roles or to any address off the list and with
/// value (G1, N-7), `relay` (G1), setting changes outside a proposal (G5), and initialising the clone or the
/// implementation (I3). Each call is tried; a success sets `ghostEveWon`.
contract GovernorAttackerHandler is Test {
    Governor internal immutable governor;
    Governor internal immutable implementation;
    address internal immutable eve;
    address internal immutable shareholder;
    address internal immutable safe;
    address internal immutable roles;
    MockNFT721 public immutable nft721;
    MockNFT1155 public immutable nft1155;

    bool public ghostEveWon;
    uint256 public attempts;
    uint256 internal nextNft;
    uint256[] public sentIds;

    constructor(
        Governor governor_,
        Governor implementation_,
        address eve_,
        address shareholder_,
        address safe_,
        address roles_
    ) {
        governor = governor_;
        implementation = implementation_;
        eve = eve_;
        shareholder = shareholder_;
        safe = safe_;
        roles = roles_;
        nft721 = new MockNFT721();
        nft1155 = new MockNFT1155();
    }

    function sentIdCount() external view returns (uint256) {
        return sentIds.length;
    }

    function _won() internal {
        ghostEveWon = true;
    }

    function _from(uint256 seed) internal view returns (address) {
        uint256 i = seed % 3;
        return i == 0 ? eve : i == 1 ? safe : shareholder;
    }

    // ------------------------------------------------------------------ deposits (G4)

    function sendEther(uint256 seed, uint256 amount) external {
        attempts++;
        address from = _from(seed);
        amount = bound(amount, 1, 100 ether);
        vm.deal(from, amount);
        vm.prank(from);
        (bool ok,) = address(governor).call{ value: amount }("");
        if (ok) _won();
    }

    function sendERC721() external {
        attempts++;
        uint256 id = ++nextNft;
        nft721.mint(eve, id);
        vm.prank(eve);
        try nft721.safeTransferFrom(eve, address(governor), id) {
            _won();
        } catch { }
    }

    function sendERC1155(uint256 id, uint256 amount) external {
        attempts++;
        amount = bound(amount, 1, 1e18);
        nft1155.mint(eve, id, amount);
        sentIds.push(id);
        vm.prank(eve);
        try nft1155.safeTransferFrom(eve, address(governor), id, amount, "") {
            _won();
        } catch { }
    }

    function sendERC1155Batch(uint256 id, uint256 amount) external {
        attempts++;
        amount = bound(amount, 1, 1e18);
        id = bound(id, 0, type(uint256).max - 1);
        nft1155.mint(eve, id, amount);
        nft1155.mint(eve, id + 1, amount);
        sentIds.push(id);
        sentIds.push(id + 1);
        uint256[] memory ids = new uint256[](2);
        (ids[0], ids[1]) = (id, id + 1);
        uint256[] memory amounts = new uint256[](2);
        (amounts[0], amounts[1]) = (amount, amount);
        vm.prank(eve);
        try nft1155.safeBatchTransferFrom(eve, address(governor), ids, amounts, "") {
            _won();
        } catch { }
    }

    // ------------------------------------------------------------------ proposals and execution (G1, N-7)

    /// @dev A shareholder's account proposes a call to the Safe, Roles or any address off the list.
    function proposeForbidden(uint256 which, address anyTarget) external {
        attempts++;
        uint256 w = which % 3;
        address target = w == 0 ? safe : w == 1 ? roles : anyTarget;
        if (w == 2 && governor.isAllowedTarget(target)) target = safe;
        address[] memory targets = new address[](1);
        targets[0] = target;
        vm.prank(shareholder);
        try governor.propose(
            targets, new uint256[](1), new bytes[](1), string.concat("forbidden ", vm.toString(attempts))
        ) {
            _won();
        } catch { }
    }

    /// @dev A shareholder's account proposes an allowed call that carries ether.
    function proposeWithValue(uint256 value) external {
        attempts++;
        address[] memory targets = new address[](1);
        targets[0] = address(governor);
        uint256[] memory values = new uint256[](1);
        values[0] = bound(value, 1, type(uint256).max);
        vm.prank(shareholder);
        try governor.propose(targets, values, new bytes[](1), string.concat("value ", vm.toString(attempts))) {
            _won();
        } catch { }
    }

    /// @dev `execute` with ether, for a made-up proposal; and `relay` by anyone.
    function executeWithEther(uint256 seed, uint256 value) external {
        attempts++;
        address from = _from(seed);
        value = bound(value, 1, 100 ether);
        vm.deal(from, value);
        address[] memory targets = new address[](1);
        targets[0] = safe;
        vm.prank(from);
        try governor.execute{ value: value }(targets, new uint256[](1), new bytes[](1), bytes32(seed)) {
            _won();
        } catch { }
    }

    function relay(uint256 seed, address target, uint256 value, bytes calldata data) external {
        attempts++;
        address from = _from(seed);
        value = bound(value, 0, 100 ether);
        vm.deal(from, value);
        vm.prank(from);
        try governor.relay{ value: value }(target, value, data) {
            _won();
        } catch { }
    }

    // ------------------------------------------------------------------ settings outside a proposal (G5)

    function changeSetting(uint256 seed, uint256 which, uint256 value) external {
        attempts++;
        address from = _from(seed);
        uint256 w = which % 4;
        vm.prank(from);
        if (w == 0) {
            try governor.setVotingDelay(uint48(bound(value, 0, 365 days))) {
                _won();
            } catch { }
        } else if (w == 1) {
            try governor.setVotingPeriod(uint32(bound(value, 1, 365 days))) {
                _won();
            } catch { }
        } else if (w == 2) {
            try governor.setProposalThreshold(value) {
                _won();
            } catch { }
        } else {
            try governor.updateQuorumNumerator(bound(value, 0, 10_000)) {
                _won();
            } catch { }
        }
    }

    // ------------------------------------------------------------------ initialisation (I3)

    function reinitialize(uint256 seed) external {
        attempts++;
        address[] memory targets = new address[](1);
        targets[0] = eve;
        vm.prank(_from(seed));
        try governor.initialize("Eve", IERC5805(eve), eve, targets, 0, 1, 0, 0) {
            _won();
        } catch { }
    }

    function initializeImplementation() external {
        attempts++;
        address[] memory targets = new address[](1);
        targets[0] = eve;
        vm.prank(eve);
        try implementation.initialize("Eve", IERC5805(eve), eve, targets, 0, 1, 0, 0) {
            _won();
        } catch { }
    }
}
