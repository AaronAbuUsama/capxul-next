// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { IWaterfall } from "../interfaces/IWaterfall.sol";

/// @title Waterfall
/// @notice What an exit's proceeds pay each share class and each option group (spec/exits.md "Waterfall").
/// @dev Internal and pure. The vocabulary (structs and `WaterfallDidNotSettle`) is in IWaterfall. Every
/// division rounds down.
///
/// X1 by construction: payouts are drawn from a running remainder of the proceeds (preferences first, then the
/// Common tier, then options), each at most what remains, and the last class paid takes what is left, so they
/// add up to the proceeds exactly. The cap never binds: the shares of what is left add up to at most what is
/// left, and an exercised group's strikes come back out of its own share.
///
/// Two arithmetic modes, chosen once from the inputs. Inputs within the bounds of `_isSmall` (proceeds and
/// preferences below 2^96, shares and strikes below 2^64, at most 2^16 classes and groups; every real cap
/// table) cannot overflow anywhere below, so they are computed unchecked; anything larger is computed checked,
/// with OpenZeppelin's full-precision `mulDiv`. Both modes give the same numbers. The code is branch-free on
/// the data (decisions are 0/1 values combined with a bitwise select), so a round's only data-dependent branch
/// is whether it changed a decision: the symbolic checks (fv/halmos.md "Waterfall sizing") see one path per
/// number of rounds rather than one per decision sequence.
library Waterfall {
    using SafeCast for bool;

    /// @dev One pricing of the sale for a given set of conversions and exercises.
    struct Pricing {
        /// @dev What each class gets towards its preference (0 for a class not paying one).
        uint256[] preferencePaid;
        /// @dev What is left for the Common tier once the preferences are paid, strikes of exercised groups in.
        uint256 left;
        /// @dev As-converted shares the Common tier divides it over.
        uint256 commonShares;
        /// @dev `left / commonShares`, rounded down (0 when there are none).
        uint256 price;
    }

    /// @notice What the proceeds pay each class and each option group, index for index with the inputs.
    /// @param proceeds The sale's proceeds, in sale-token units.
    /// @param classes Every class with outstanding shares (the company Safe's left out, ruling D5).
    /// @param groups The option groups (Exits passes one per live grant).
    /// @return result The payouts; they add up to `proceeds` exactly (X1).
    function compute(
        uint256 proceeds,
        IWaterfall.ClassInput[] memory classes,
        IWaterfall.OptionGroup[] memory groups
    )
        internal
        pure
        returns (IWaterfall.Result memory result)
    {
        bool exact = !_isSmall(proceeds, classes, groups);
        uint256 n = classes.length;
        uint256 m = groups.length;
        result.converted = new bool[](n);
        result.exercised = new bool[](m);
        for (uint256 j; j < m; ++j) {
            result.exercised[j] = true;
        }

        // Each round prices the sale for the current state and re-decides; a round that changes nothing is
        // the answer. Monotone changes need at most n + m of them, plus one that confirms.
        for (uint256 round; round < n + m + 1; ++round) {
            Pricing memory p = _price(proceeds, classes, groups, result, exact);
            if (!_redecide(classes, groups, result, p.price, exact)) {
                return _pay(proceeds, classes, groups, result, p, exact);
            }
        }
        revert IWaterfall.WaterfallDidNotSettle();
    }

    /// @dev Pays the preferences of the classes not converting, by seniority (each rank in full, or pro rata
    /// from what the ranks above it left), then prices Common.
    function _price(
        uint256 proceeds,
        IWaterfall.ClassInput[] memory classes,
        IWaterfall.OptionGroup[] memory groups,
        IWaterfall.Result memory state,
        bool exact
    )
        private
        pure
        returns (Pricing memory p)
    {
        uint256 n = classes.length;
        uint256 cash = proceeds;
        for (uint256 j; j < groups.length; ++j) {
            uint256 strikes = _mul(groups[j].shares, groups[j].strike, exact);
            cash = _add(cash, _select(state.exercised[j], strikes, 0), exact);
        }

        p.preferencePaid = new uint256[](n);
        uint256 owedAll = 0;
        for (uint256 i; i < n; ++i) {
            bool pays = _paysPreference(classes[i], state.converted[i]);
            p.preferencePaid[i] = _select(pays, _preferencePaid(classes, state, i, cash, exact), 0);
            owedAll = _add(owedAll, _select(pays, classes[i].preference, 0), exact);
        }
        p.left = _subFloor(cash, owedAll);

        for (uint256 i; i < n; ++i) {
            bool tier = _inCommonTier(classes[i], state.converted[i]);
            p.commonShares = _add(p.commonShares, _select(tier, classes[i].asConvertedShares, 0), exact);
        }
        for (uint256 j; j < groups.length; ++j) {
            p.commonShares = _add(p.commonShares, _select(state.exercised[j], groups[j].shares, 0), exact);
        }
        p.price = _div(p.left, p.commonShares);
    }

    /// @dev What class `i` would be paid towards its preference: in full when the cash the senior ranks left
    /// covers its rank, otherwise its pro rata part of that cash.
    function _preferencePaid(
        IWaterfall.ClassInput[] memory classes,
        IWaterfall.Result memory state,
        uint256 i,
        uint256 cash,
        bool exact
    )
        private
        pure
        returns (uint256)
    {
        uint256 above = 0;
        uint256 same = 0;
        for (uint256 k; k < classes.length; ++k) {
            uint256 owed = _select(_paysPreference(classes[k], state.converted[k]), classes[k].preference, 0);
            above = _add(above, _select(classes[k].seniority < classes[i].seniority, owed, 0), exact);
            same = _add(same, _select(classes[k].seniority == classes[i].seniority, owed, 0), exact);
        }
        uint256 rankCash = _subFloor(cash, above);
        return _select(
            rankCash >= same, classes[i].preference, _mulDiv(classes[i].preference, _min(rankCash, same), same, exact)
        );
    }

    /// @dev Converts a non-participating class worth more as Common than its preference, and exercises a group
    /// whose strike is below the price. Returns whether anything changed.
    function _redecide(
        IWaterfall.ClassInput[] memory classes,
        IWaterfall.OptionGroup[] memory groups,
        IWaterfall.Result memory state,
        uint256 price,
        bool exact
    )
        private
        pure
        returns (bool)
    {
        uint256 changed = 0;
        for (uint256 i; i < classes.length; ++i) {
            IWaterfall.ClassInput memory c = classes[i];
            bool convert = (c.preference != 0).toUint() & (!c.participating).toUint()
                    & _worthMore(c.asConvertedShares, price, c.preference, exact).toUint() == 1;
            changed |= (convert != state.converted[i]).toUint();
            state.converted[i] = convert;
        }
        for (uint256 j; j < groups.length; ++j) {
            bool exercise = price > groups[j].strike;
            changed |= (exercise != state.exercised[j]).toUint();
            state.exercised[j] = exercise;
        }
        return changed != 0;
    }

    /// @dev The payouts at the settled state: preferences, then each Common-tier class's share of what is left
    /// at full precision, then each exercised group's share less the strikes it brought in, each drawn from what
    /// remains of the proceeds. The last class with a nonzero payout (the last class if none) takes the rounding
    /// remainder. Every subtraction and sum below is at most `proceeds`, so none can wrap.
    function _pay(
        uint256 proceeds,
        IWaterfall.ClassInput[] memory classes,
        IWaterfall.OptionGroup[] memory groups,
        IWaterfall.Result memory result,
        Pricing memory p,
        bool exact
    )
        private
        pure
        returns (IWaterfall.Result memory)
    {
        uint256 n = classes.length;
        result.commonPrice = p.price;
        result.classPayouts = new uint256[](n);
        result.optionPayouts = new uint256[](groups.length);
        uint256 remaining = proceeds;
        unchecked {
            for (uint256 i; i < n; ++i) {
                uint256 pay = _min(p.preferencePaid[i], remaining);
                remaining -= pay;
                result.classPayouts[i] = pay;
            }
            uint256 last = n;
            for (uint256 i; i < n; ++i) {
                // Only a Common-tier class's shares are in `commonShares`, so its share is at most `left`.
                uint256 tierShares =
                    _select(_inCommonTier(classes[i], result.converted[i]), classes[i].asConvertedShares, 0);
                uint256 share = _mulDiv(tierShares, p.left, p.commonShares, exact);
                uint256 pay = _min(share, remaining);
                remaining -= pay;
                result.classPayouts[i] += pay;
                last = _select(result.classPayouts[i] != 0, i, last);
            }
            for (uint256 j; j < groups.length; ++j) {
                uint256 exercisedShares = _select(result.exercised[j], groups[j].shares, 0);
                uint256 share = _mulDiv(exercisedShares, p.left, p.commonShares, exact);
                uint256 net = _subFloor(share, _mul(groups[j].shares, groups[j].strike, exact));
                uint256 pay = _min(_select(result.exercised[j], net, 0), remaining);
                remaining -= pay;
                result.optionPayouts[j] = pay;
            }
            if (n != 0) {
                last = _select(last == n, n - 1, last);
                for (uint256 i; i < n; ++i) {
                    result.classPayouts[i] += _select(i == last, remaining, 0);
                }
            }
        }
        return result;
    }

    /// @dev Whether every input is within the bounds under which no step overflows: cash below
    /// 2^96 + 2^16 * 2^128 < 2^145, preference sums below 2^112, share sums below 2^81, and every product
    /// (shares or preferences times money) below 2^210.
    function _isSmall(
        uint256 proceeds,
        IWaterfall.ClassInput[] memory classes,
        IWaterfall.OptionGroup[] memory groups
    )
        private
        pure
        returns (bool)
    {
        uint256 ok = (proceeds <= type(uint96).max).toUint() & (classes.length <= type(uint16).max).toUint()
            & (groups.length <= type(uint16).max).toUint();
        for (uint256 i; i < classes.length; ++i) {
            ok &= (classes[i].asConvertedShares <= type(uint64).max).toUint()
            & (classes[i].preference <= type(uint96).max).toUint();
        }
        for (uint256 j; j < groups.length; ++j) {
            ok &= (groups[j].shares <= type(uint64).max).toUint() & (groups[j].strike <= type(uint64).max).toUint();
        }
        return ok == 1;
    }

    /// @dev Whether `shares * price > preference`. The exact mode tests `shares > 0 && price > preference /
    /// shares` instead, the same for whole numbers, which cannot overflow; small inputs multiply directly.
    function _worthMore(uint256 shares, uint256 price, uint256 preference, bool exact) private pure returns (bool) {
        if (exact) return shares != 0 && price > preference / shares;
        unchecked {
            return shares * price > preference;
        }
    }

    /// @dev `x * y / d` rounded down, and 0 when `d` is 0.
    function _mulDiv(uint256 x, uint256 y, uint256 d, bool exact) private pure returns (uint256) {
        if (exact) return d == 0 ? 0 : Math.mulDiv(x, y, d);
        unchecked {
            return _div(x * y, d);
        }
    }

    function _mul(uint256 x, uint256 y, bool exact) private pure returns (uint256) {
        if (exact) return x * y;
        unchecked {
            return x * y;
        }
    }

    function _add(uint256 x, uint256 y, bool exact) private pure returns (uint256) {
        if (exact) return x + y;
        unchecked {
            return x + y;
        }
    }

    /// @dev `a / b` rounded down, and 0 when `b` is 0 (the EVM's DIV).
    function _div(uint256 a, uint256 b) private pure returns (uint256 q) {
        assembly ("memory-safe") {
            q := div(a, b)
        }
    }

    /// @dev `condition ? a : b` without a branch or a multiplication (OpenZeppelin's `Math.ternary` multiplies,
    /// which a symbolic engine cannot see through).
    function _select(bool condition, uint256 a, uint256 b) private pure returns (uint256) {
        unchecked {
            return b ^ ((a ^ b) & (0 - condition.toUint()));
        }
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return _select(a < b, a, b);
    }

    /// @dev `a - b`, or 0 when `b` is larger.
    function _subFloor(uint256 a, uint256 b) private pure returns (uint256) {
        unchecked {
            return _select(a > b, a - b, 0);
        }
    }

    /// @dev A class with a preference that has not converted pays it out.
    function _paysPreference(IWaterfall.ClassInput memory c, bool converted) private pure returns (bool) {
        return (c.preference != 0).toUint() & (!converted).toUint() == 1;
    }

    /// @dev Common, a converted class and a participating class share what is left as converted.
    function _inCommonTier(IWaterfall.ClassInput memory c, bool converted) private pure returns (bool) {
        return (c.preference == 0).toUint() | converted.toUint() | c.participating.toUint() == 1;
    }
}
