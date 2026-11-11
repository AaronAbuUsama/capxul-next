// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

import { Options_Shared_Test } from "../../../utils/Options/Options_Shared_Test.sol";

/// @dev `vestedOf` against the model over the grant size, the schedule (2026 to 2040) and any time up to 2060;
/// monotone in time and never above the grant (O1's `vested` side).
contract VestedOf_Options_Unit_Fuzz_Test is Options_Shared_Test {
    function testFuzz_VestedOf(uint128 shares, uint64 months, uint64 cliffMonths, uint64 t1, uint64 t2) external {
        shares = uint128(bound(shares, 1, POOL));
        months = uint64(bound(months, 1, 120));
        cliffMonths = uint64(bound(cliffMonths, 0, months));
        uint64 end = _monthsFromStart(months);
        uint64 cliff = _monthsFromStart(cliffMonths);
        uint256 id = _grant(users.alice, shares, gStart, cliff, end, end + 1);
        _accept(id); // vestedOf of an unaccepted offer is not pinned by the spec
        uint64 hi = _date(2060, 1, 1);
        t1 = uint64(bound(t1, gStart, hi));
        t2 = uint64(bound(t2, t1, hi));
        uint128 v1 = options.vestedOf(id, t1);
        assertEq(v1, _model(shares, gStart, cliff, end, 0, t1), "model");
        assertLe(v1, options.vestedOf(id, t2), "monotone");
        assertLe(options.vestedOf(id, t2), shares, "at most the grant");
    }

    function testFuzz_VestedOf_FrozenAtEnd(uint64 endedAt, uint64 t) external {
        uint256 id = _acceptedGrant();
        endedAt = uint64(bound(endedAt, _now(), gEnd + 365 days));
        _end(id, endedAt);
        t = uint64(bound(t, gStart, _date(2060, 1, 1)));
        assertEq(options.vestedOf(id, t), _model(SHARES, gStart, gCliff, gEnd, endedAt, t), "frozen model");
    }

    /// @dev 1 January 2026 plus `k` whole calendar months.
    function _monthsFromStart(uint64 k) private pure returns (uint64) {
        return _date(2026 + k / 12, 1 + k % 12, 1);
    }
}
