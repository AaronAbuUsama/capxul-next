// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @title IHatsEvents
/// @notice The events of Hats Protocol v1 (0x3bc1A0Ad72417f2d411118085256fC53CBdDd137) and the id helper that Capxul's
/// off-chain code reads (Hats-Protocol/hats-protocol, `src/Interfaces/HatsEvents.sol`, `IHatsIdUtilities.sol`, and
/// the ERC-1155 of solbase it inherits, whose `TransferSingle` names its last field `amount`). No contract of this
/// package imports it, so a change here changes no deployed code (roadmap step 3.1).
interface IHatsEvents {
    /// @notice A hat was minted (`from` is zero), burned (`to` is zero) or transferred.
    event TransferSingle(
        address indexed operator, address indexed from, address indexed to, uint256 id, uint256 amount
    );

    /// @notice How many may wear a hat changed.
    event HatMaxSupplyChanged(uint256 hatId, uint32 newMaxSupply);

    /// @notice The id of `admin`'s child hat whose local id is `newHat`.
    function buildHatId(uint256 admin, uint16 newHat) external pure returns (uint256 id);
}
