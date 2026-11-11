// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.28;

/// @dev The two Capxul exits (docs/planning/protocol-v4/scenarios/capxul-vectors.json, "exits"): the cap table
/// at the secondary sale (Mar 2033) and what each holding receives, in USDC units.
///
/// The JSON's payouts come from the Company Book simulation, which gives a preferred class fractional
/// as-converted shares (4,780,305 Series A at 2.5103 / 2.4745 = 4,849,464.68...). On chain a class's
/// as-converted shares are whole (IWaterfall: "shares are whole"), as the JSON's own `asConverted` rows are.
/// The expected payouts below are the simulation's algorithm re-run in exact arithmetic on those whole
/// counts (plans/Exits.md, "Vectors"); they differ from the JSON's float payouts by at most $3.43 (Series A
/// lead, strong sale), and the contract must match them to within $1.
library CapxulExitVectors {
    uint256 internal constant STRONG = 400_000_000e6;
    uint256 internal constant SOFT = 90_000_000e6;

    struct Row {
        string who;
        uint8 classId; // 0 Common, 1 Seed, 2 Series A, 3 Series B, 4 Series C; options are on Common
        bool option;
        uint128 shares;
        uint128 strike; // options only, USDC units per share
        uint256 strong;
        uint256 soft;
    }

    function rows() internal pure returns (Row[] memory r) {
        r = new Row[](14);
        r[0] = Row("Aaron (founder)", 0, false, 4_600_000, 0, 55_340_566_494_468, 9_964_864_322_953);
        r[1] = Row("Second founder", 0, false, 3_000_000, 0, 36_091_673_800_740, 6_498_824_558_447);
        r[2] = Row("Angel investor", 1, false, 250_000, 0, 3_007_639_483_395, 541_568_713_204);
        r[3] = Row("Pre-seed fund", 1, false, 750_000, 0, 9_022_918_450_185, 1_624_706_139_612);
        r[4] = Row("Seed lead", 1, false, 2_628_581, 0, 31_623_296_003_608, 5_694_228_918_889);
        r[5] = Row("Series A lead", 2, false, 4_780_305, 0, 58_341_757_598_810, 11_999_999_641_500);
        r[6] = Row("Series B lead", 3, false, 5_058_084, 0, 72_069_478_370_638, 30_000_002_012_400);
        r[7] = Row("Series C lead", 4, false, 8_430_282, 0, 101_420_995_997_416, 20_000_001_016_800);
        r[8] = Row("Series C lead", 0, false, 400_000, 0, 4_812_223_173_432, 866_509_941_126);
        r[9] = Row("First engineer (human)", 0, true, 150_000, 0.05e6, 1_797_083_690_037, 317_441_227_922);
        r[10] = Row("Ops agent (AI member)", 0, true, 50_000, 0.05e6, 599_027_896_679, 105_813_742_641);
        r[11] = Row("Team grants 2028", 0, true, 600_000, 0.3e6, 7_038_334_760_148, 1_119_764_911_689);
        r[12] = Row("Team grants 2029", 0, true, 1_000_000, 0.9e6, 11_130_557_933_580, 1_266_274_852_816);
        r[13] = Row("Team grants 2030", 0, true, 800_000, 2.4e6, 7_704_446_346_864, 0);
    }
}
