// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @title IHats
/// @notice The parts of Hats Protocol v1 (0x3bc1A0Ad72417f2d411118085256fC53CBdDd137) that the protocol calls.
/// Signatures checked against the source verified on Base Sepolia Blockscout (Hats-Protocol/hats-protocol,
/// `src/Interfaces/IHats.sol`).
interface IHats {
    /// @notice `mintHat` to an account the hat's eligibility module rules ineligible (`HatsErrors.sol`).
    error NotEligible();

    /// @notice Mints a new top hat to `target`. Anyone may call it.
    /// @param target The wearer.
    /// @param details The hat's details.
    /// @param imageURI The hat's image URI.
    /// @return topHatId The new top hat.
    function mintTopHat(
        address target,
        string memory details,
        string memory imageURI
    )
        external
        returns (uint256 topHatId);

    /// @notice Creates a hat under `admin`. The caller must be an admin of the new hat. Eligibility and toggle
    /// must be nonzero.
    /// @param admin The parent hat.
    /// @param details The hat's details.
    /// @param maxSupply The most wearers at once.
    /// @param eligibility The eligibility module or account.
    /// @param toggle The toggle module or account.
    /// @param mutable_ Whether its admins may change it later.
    /// @param imageURI The hat's image URI.
    /// @return newHatId The new hat.
    function createHat(
        uint256 admin,
        string calldata details,
        uint32 maxSupply,
        address eligibility,
        address toggle,
        bool mutable_,
        string calldata imageURI
    )
        external
        returns (uint256 newHatId);

    /// @notice Mints a hat to an eligible wearer below its max supply. Admin only.
    /// @param hatId The hat.
    /// @param wearer The wearer.
    /// @return success True on success.
    function mintHat(uint256 hatId, address wearer) external returns (bool success);

    /// @notice Moves a hat from one wearer to another. Admin only; the hat must be mutable unless it is a top hat.
    /// @param hatId The hat.
    /// @param from The current wearer.
    /// @param to The new wearer.
    function transferHat(uint256 hatId, address from, address to) external;

    /// @notice Changes a mutable hat's eligibility module. Admin only.
    /// @param hatId The hat.
    /// @param newEligibility The new eligibility module or account.
    function changeHatEligibility(uint256 hatId, address newEligibility) external;

    /// @notice Changes a mutable hat's toggle module. Admin only.
    /// @param hatId The hat.
    /// @param newToggle The new toggle module or account.
    function changeHatToggle(uint256 hatId, address newToggle) external;

    /// @notice Changes a mutable hat's max supply; never below its current supply. Admin only.
    /// @param hatId The hat.
    /// @param newMaxSupply The new max supply.
    function changeHatMaxSupply(uint256 hatId, uint32 newMaxSupply) external;

    /// @notice Asks the hat's eligibility module about `wearer` and burns their hat if they are no longer
    /// eligible. Anyone may call it.
    /// @param hatId The hat.
    /// @param wearer The wearer.
    /// @return updated True if the wearer's status changed.
    function checkHatWearerStatus(uint256 hatId, address wearer) external returns (bool updated);

    /// @notice Whether `user` wears the hat: holds it, the hat is active and the user is eligible (live reads of
    /// the toggle and eligibility modules).
    /// @param user The account.
    /// @param hatId The hat.
    /// @return isWearer True if `user` wears it.
    function isWearerOfHat(address user, uint256 hatId) external view returns (bool isWearer);

    /// @notice Whether `user` wears an admin hat of `hatId`.
    /// @param user The account.
    /// @param hatId The hat.
    /// @return isAdmin True if `user` is an admin.
    function isAdminOfHat(address user, uint256 hatId) external view returns (bool isAdmin);

    /// @notice Whether `wearer` is in good standing for the hat.
    /// @param wearer The account.
    /// @param hatId The hat.
    /// @return standing True if in good standing.
    function isInGoodStanding(address wearer, uint256 hatId) external view returns (bool standing);

    /// @notice A hat's settings and state.
    /// @param hatId The hat.
    /// @return details The details.
    /// @return maxSupply The max supply (0 if the hat does not exist).
    /// @return supply The current supply.
    /// @return eligibility The eligibility module or account.
    /// @return toggle The toggle module or account.
    /// @return imageURI The image URI.
    /// @return lastHatId The last child hat's local id.
    /// @return mutable_ Whether its admins may change it.
    /// @return active Whether it is active.
    function viewHat(uint256 hatId)
        external
        view
        returns (
            string memory details,
            uint32 maxSupply,
            uint32 supply,
            address eligibility,
            address toggle,
            string memory imageURI,
            uint16 lastHatId,
            bool mutable_,
            bool active
        );

    /// @notice How many tokens of the hat exist, lapsed wearers' tokens included until they are burned.
    /// @param hatId The hat.
    /// @return supply The supply.
    function hatSupply(uint256 hatId) external view returns (uint32 supply);
}
