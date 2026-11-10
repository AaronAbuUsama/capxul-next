// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @dev Calendar.periodIndex and dates as spec/calendar.md defines them, computed independently of
/// the Calendar library so Budgets' tests do not check Calendar against itself.
library BudgetsCalendar {
    /// @dev `year*12+month-1` for a month (0), `year*4+(month-1)/3` for a quarter (1), `year` for a year (2).
    function periodIndex(uint8 period, uint256 t) internal pure returns (uint64) {
        (uint256 y, uint256 m,) = dateOf(t / 1 days);
        if (period == 0) return uint64(y * 12 + m - 1);
        if (period == 1) return uint64(y * 4 + (m - 1) / 3);
        return uint64(y);
    }

    /// @dev 00:00 UTC on a date (days from civil, H. Hinnant).
    function timestamp(uint256 y, uint256 m, uint256 d) internal pure returns (uint64) {
        uint256 yy = m <= 2 ? y - 1 : y;
        uint256 era = yy / 400;
        uint256 yoe = yy - era * 400;
        uint256 mp = m > 2 ? m - 3 : m + 9;
        uint256 doy = (153 * mp + 2) / 5 + d - 1;
        uint256 doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        return uint64((era * 146_097 + doe - 719_468) * 1 days);
    }

    function dateOf(uint256 z) internal pure returns (uint256 y, uint256 m, uint256 d) {
        z += 719_468;
        uint256 era = z / 146_097;
        uint256 doe = z - era * 146_097;
        uint256 yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
        uint256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        uint256 mp = (5 * doy + 2) / 153;
        d = doy - (153 * mp + 2) / 5 + 1;
        m = mp < 10 ? mp + 3 : mp - 9;
        y = yoe + era * 400 + (m <= 2 ? 1 : 0);
    }
}
