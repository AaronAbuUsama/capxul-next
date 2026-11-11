// SPDX-License-Identifier: GPL-3.0-or-later
//
// The Calendar summaries the Budgets and Agreements specs import (fv/certora.md "Calendar"; invariants B1,
// A1). Calendar itself has no Certora rules: it is pure maths, proved by Halmos (C1, C2, C5 for WEEK) and by
// the exhaustive Foundry loops in test/exhaustive/Calendar.exhaustive.t.sol (C1/C2 across month starts, C9).
// Those proofs are what make these axioms sound:
//   - periodIndex monotone in t                       <= C9 (testExhaustive_C9_periodIndex_shardNN)
//   - earned 0 for to <= from, additive over a split  <= C1 (check_C1_*, testExhaustive_C1_C2_monthBoundaries)
//   - earned monotone in to                           <= C2 (follows from additive and non-negative)
// The summaries assume a known period: Budgets and Agreements validate the period before any Calendar call,
// and the unknown-period reverts are unit tested in the Calendar trees.
//
// Use: `import "CalendarSummaries.spec";` from a contract spec whose contract calls the Calendar library.

methods {
    function Calendar.periodIndex(uint8 p, uint256 t) internal returns (uint256) => periodIndexGhost(p, t);
    function Calendar.earned(uint256 rate, uint8 p, uint256 from, uint256 to) internal returns (uint256)
        => earnedGhost(rate, p, from, to);
}

ghost periodIndexGhost(uint8, uint256) returns uint256 {
    axiom forall uint8 p. forall uint256 t1. forall uint256 t2.
        t1 <= t2 => periodIndexGhost(p, t1) <= periodIndexGhost(p, t2);
}

ghost earnedGhost(uint256, uint8, uint256, uint256) returns uint256 {
    axiom forall uint256 r. forall uint8 p. forall uint256 a. forall uint256 b.
        b <= a => earnedGhost(r, p, a, b) == 0;
    axiom forall uint256 r. forall uint8 p. forall uint256 a. forall uint256 b. forall uint256 c.
        (a <= b && b <= c) => earnedGhost(r, p, a, c) == earnedGhost(r, p, a, b) + earnedGhost(r, p, b, c);
}
