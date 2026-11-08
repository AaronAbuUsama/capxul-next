// The time design's records: its decisions (defineDecision), invariants (defineInvariant) and any
// other record it adds. One writer: the time designer. Explained in docs/design/time.md.

import { defineDecision } from "../../../packages/book/src/index.ts";
import * as f from "./foundation.ts";

const BY = "Claude, time design, 8 November 2026";
export const by = (evidence: string) => `${BY}; evidence: ${evidence}`;

// Keep `defineDecision` and `f` in use until the first record lands.
export const _uses = [defineDecision, f] as const;
