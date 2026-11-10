// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Rounds } from "../../../src/equity/Rounds.sol";

/// @notice Exposes Rounds' round maths to Halmos and the fuzz tests. It changes no behaviour.
contract RoundsMathHarness is Rounds {
    function exposed_payAmount(uint128 shares, uint128 price) external pure returns (uint256) {
        return _payAmount(shares, price);
    }

    function exposed_conversionPrice(
        uint128 valuationCap,
        uint256 companyCapitalization,
        uint128 price,
        uint16 discountBps
    )
        external
        pure
        returns (uint256)
    {
        return _conversionPrice(valuationCap, companyCapitalization, price, discountBps);
    }

    function exposed_conversionShares(uint128 amount, uint256 conversionPrice) external pure returns (uint256) {
        return _conversionShares(amount, conversionPrice);
    }

    function exposed_antiDilutedPrice(
        uint128 cp1,
        uint128 price,
        uint256 deemedOutstandingA,
        uint256 issuedC
    )
        external
        pure
        returns (uint128)
    {
        return _antiDilutedPrice(cp1, price, deemedOutstandingA, issuedC);
    }
}
