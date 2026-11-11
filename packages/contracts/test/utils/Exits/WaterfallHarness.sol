// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { IWaterfall } from "../../../src/interfaces/IWaterfall.sol";
import { Waterfall } from "../../../src/libraries/Waterfall.sol";

/// @dev Exposes the internal `Waterfall.compute` so tests, fuzz and Halmos can call it (trees/README.md: the
/// libraries are tested through a small harness).
contract WaterfallHarness {
    function compute(
        uint256 proceeds,
        IWaterfall.ClassInput[] memory classes,
        IWaterfall.OptionGroup[] memory groups
    )
        external
        pure
        returns (IWaterfall.Result memory)
    {
        return Waterfall.compute(proceeds, classes, groups);
    }
}

/// @dev Builders for waterfall inputs.
library WaterfallInputs {
    function cls(
        uint8 classId,
        uint256 asConvertedShares,
        uint256 preference,
        bool participating,
        uint8 seniority
    )
        internal
        pure
        returns (IWaterfall.ClassInput memory)
    {
        return IWaterfall.ClassInput(classId, asConvertedShares, preference, participating, seniority);
    }

    function total(IWaterfall.Result memory r) internal pure returns (uint256 sum) {
        for (uint256 i; i < r.classPayouts.length; ++i) {
            sum += r.classPayouts[i];
        }
        for (uint256 i; i < r.optionPayouts.length; ++i) {
            sum += r.optionPayouts[i];
        }
    }
}
