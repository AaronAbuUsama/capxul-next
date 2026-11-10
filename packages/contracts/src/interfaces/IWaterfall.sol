// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @title IWaterfall
/// @notice The vocabulary of the `Waterfall` library (src/libraries/Waterfall.sol): what an exit's
/// proceeds pay each share class and each option group (docs/planning/protocol-v4/spec/exits.md).
/// @dev The library is internal and pure; it reverts with the error below. Every division rounds
/// down, and the remainder goes to the last payee, so the payouts add up to the proceeds exactly (X1).
/// Amounts are in the sale token's units; shares are whole (ShareClass has 0 decimals).
interface IWaterfall {
    /// @notice One share class at the exit. Shares held by the company Safe are left out (ruling D5).
    struct ClassInput {
        uint8 classId;
        /// @dev The class's outstanding shares, as converted into Common.
        uint256 asConvertedShares;
        /// @dev The class's preference total: shares * originalIssuePrice * preferenceMultipleBps / 10,000
        /// (0 for Common).
        uint256 preference;
        /// @dev Takes its preference and then its as-converted share of what is left.
        bool participating;
        /// @dev 0 is most senior; equal ranks are paid pari passu, pro rata when cash runs out.
        uint8 seniority;
    }

    /// @notice A group of option grants with one strike.
    struct OptionGroup {
        uint256 shares;
        /// @dev Sale-token units per share.
        uint256 strike;
    }

    /// @notice What the waterfall pays, index for index with its inputs.
    struct Result {
        uint256[] classPayouts;
        /// @dev shares * (commonPrice - strike) for an exercised group, otherwise 0.
        uint256[] optionPayouts;
        bool[] converted;
        bool[] exercised;
        /// @dev Sale-token units per Common share, rounded down.
        uint256 commonPrice;
    }

    /// @notice The conversions and exercises did not settle within classes + groups + 1 rounds.
    error WaterfallDidNotSettle();
}
