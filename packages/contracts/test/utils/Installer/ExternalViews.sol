// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IHatsSignerGate } from "../../../src/interfaces/external/IHatsSignerGate.sol";

/// @notice The reads and writes of the real third-party contracts the Installer tests need beyond
/// `src/interfaces/external`. Getter names probed on Base Sepolia with `cast call` (27 Oct 2026).

/// @dev Safe 1.4.1.
interface ISafeLike {
    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures
    )
        external
        payable
        returns (bool);
    function getTransactionHash(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address refundReceiver,
        uint256 nonce
    )
        external
        view
        returns (bytes32);
    function approveHash(bytes32 hashToApprove) external;
    function nonce() external view returns (uint256);
    function getOwners() external view returns (address[] memory);
    function getThreshold() external view returns (uint256);
    function isOwner(address owner) external view returns (bool);
    function isModuleEnabled(address module) external view returns (bool);
    function getModulesPaginated(
        address start,
        uint256 pageSize
    )
        external
        view
        returns (address[] memory array, address next);
    function getStorageAt(uint256 offset, uint256 length) external view returns (bytes memory);
    function addOwnerWithThreshold(address owner, uint256 threshold) external;
    function disableModule(address prevModule, address module) external;
    function changeThreshold(uint256 threshold) external;
}

/// @dev Hats Signer Gate v2.
interface IGateLike {
    function ownerHat() external view returns (uint256);
    function isValidSignerHat(uint256 hatId) external view returns (bool);
    function thresholdConfig() external view returns (IHatsSignerGate.ThresholdConfig memory);
    function claimableFor() external view returns (bool);
    function locked() external view returns (bool);
    function isModuleEnabled(address module) external view returns (bool);
    function safe() external view returns (address);
    function isValidSigner(address account) external view returns (bool);
    function claimSignerFor(uint256 hatId, address signer) external;
    function removeSigner(address signer) external;
    function setThresholdConfig(IHatsSignerGate.ThresholdConfig memory thresholdConfig) external;
    function addSignerHats(uint256[] calldata newSignerHats) external;
}

/// @dev Zodiac Roles v2.1.
interface IRolesLike {
    function owner() external view returns (address);
    function avatar() external view returns (address);
    function target() external view returns (address);
    function isModuleEnabled(address module) external view returns (bool);
    /// @return refill The amount added each period.
    /// @return maxRefill The most a refill raises the balance to.
    /// @return period The refill period in seconds.
    /// @return balance The balance at `timestamp`.
    /// @return timestamp When the current period started.
    function allowances(bytes32 key)
        external
        view
        returns (uint128 refill, uint128 maxRefill, uint64 period, uint128 balance, uint64 timestamp);
    function execTransactionWithRole(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        bytes32 roleKey,
        bool shouldRevert
    )
        external
        returns (bool success);
}

/// @dev Hats Protocol v1, the parts beyond `src/interfaces/external/IHats.sol`.
interface IHatsExtra {
    function lastTopHatId() external view returns (uint32);
    function setHatWearerStatus(uint256 hatId, address wearer, bool eligible, bool standing) external returns (bool);
}

/// @dev Hats Elections v0.2.0 reads beyond `IHatsElectionEligibility` (names probed on Base Sepolia).
interface IElectionsArgs {
    function BALLOT_BOX_HAT() external view returns (uint256);
    function ADMIN_HAT() external view returns (uint256);
    function hatId() external view returns (uint256);
}
