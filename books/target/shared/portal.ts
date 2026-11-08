// The portal design's records: its decisions (defineDecision) and any component or environment it
// adds. One writer: the portal designer. Explained in docs/design/portal.md.

import { defineDecision } from "../../../packages/book/src/index.ts";
import * as f from "./foundation.ts";

const BY = "Claude, portal design, 8 November 2026";
export const by = (evidence: string) => `${BY}; evidence: ${evidence}`;

// Keep `defineDecision` and `f` in use until the first record lands.
export const _uses = [defineDecision, f] as const;
