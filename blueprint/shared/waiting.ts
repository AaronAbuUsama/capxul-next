// Which decisions wait for Aaron. One predicate, used by packages/blueprint-engine/scripts/report-judgments.ts, archive/tools/export-explorer.ts and the
// portal's Questions page, so the three lists cannot disagree. It reads the lists in ./rulings.ts and nothing else.

import { ACCEPTED, CARRIES_OUT as CARRIES_OUT_RULINGS, REOPENED, SUPERSEDED } from "./rulings.ts";
import { CUT_FOR_AARON } from "./cut.ts";

/** The fields of a decision the predicate reads. Any decision record satisfies it. */
export type Judged = {
  readonly id: string;
  readonly title?: unknown;
  readonly question?: unknown;
  readonly why?: unknown;
  readonly chosen?: unknown;
  readonly source?: unknown;
};

/** Where a decision stands with Aaron. */
export type DecisionState = "ruling" | "superseded" | "accepted" | "for-aaron" | "settled";

// The designers and the assembly flagged these for Aaron in their reports; their text need not name him.
// The report fails if one is not a decision in the book.
// documents.acceptance-rewrites left the list once its line was kept word for word again (W1 settled).
// equity.acceptance left it when the cut parked equity (docs/cut-archive/parked/equity/): it is no longer in the book.
export const FLAGGED: readonly string[] = [
  "payroll.scope", "payments.birth-width", "parties.directory-tenancy", "procedures.accounts-admit",
  "agents.org-owned", "board.failed-proposal",
  "contacts.members-write", "notices.claim-escrow", "system.size",
  // Aaron's open questions of 11 November 2026 (shared/questions.ts)
  "thin-line.bundler", "books.founder-funding", "devnet.core-service-home", "devnet.cli-split", "devnet.record-home", "books.chart-owner", "plan.cloud-sandbox-moot",
];

/** Decisions that carry out one of Aaron's own; they cite him but need nothing from him.
 * rules.new-operations is not one: whether a pack's recommendation may book a command before he answers is his. */
// tooling.ops-owner: how task m1-ops-supervisor carried out "asking him to run commands is not acceptable"; built and
// merged on 11 November. Its text names him because it quotes him, which made the Questions page ask him to approve
// the implementation (he could not answer it, and could not tell what he was being asked).
export const CARRIES_OUT: readonly string[] = ["rules.frozen-flags-kept", "rules.frozen-flags-built-ins", "loop.gateway", "tooling.ops-owner", ...CARRIES_OUT_RULINGS];

/** Aaron's own decisions are settled, not for his review. */
export const byAaron = (d: Judged): boolean => /^Aaron\b/.test(String(d.source ?? ""));

/** True when the decision waits for Aaron: flagged, reopened, or its text names a call that is his. */
export const forAaron = (d: Judged): boolean =>
  // the coordinator's cut decisions (shared/cut.ts) carry out his rulings; only the four it names wait for him
  (d.id.startsWith("cut.") ? CUT_FOR_AARON.includes(d.id) : !/^The coordinator/.test(String(d.source ?? ""))) && !byAaron(d) && !CARRIES_OUT.includes(d.id) && !ACCEPTED.includes(d.id) && !(d.id in SUPERSEDED) &&
  (REOPENED.includes(d.id) || FLAGGED.includes(d.id) || d.id.startsWith("cut.") || /\baaron\b(?![.-][a-z])/i.test(`${d.title} ${d.question} ${d.why} ${d.chosen}`));

/** The one state of a decision, in the order the judgments report lists them. */
export const stateOf = (d: Judged): DecisionState =>
  byAaron(d) ? "ruling" : d.id in SUPERSEDED ? "superseded" : ACCEPTED.includes(d.id) ? "accepted" : forAaron(d) ? "for-aaron" : "settled";

/** The decision that replaced this one, when Aaron's ruling superseded it. */
export const supersededBy = (id: string): string | null => SUPERSEDED[id] ?? null;
