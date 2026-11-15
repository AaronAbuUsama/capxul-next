// `pnpm delta:check`: prints each finding of the delta check (the toolkit's, run over the blueprint, which passes itself
// in), one a line, and fails when there is one.
import * as Blueprint from "@capxul/blueprint";
import { deltaCheck, formats } from "@capxul/blueprint-tools";
import * as Rec from "effect/Record";

const findings = deltaCheck({ operations: Rec.keys(Blueprint.operations), formats: formats(Blueprint) });
for (const { operation, format, reason } of findings) console.error(`${operation} (${format}): ${reason}`);
if (findings.length > 0) {
  console.error(`delta check: ${findings.length} finding(s)`);
  process.exitCode = 1;
} else console.log("delta check: every operation has every format, or is on its unmigrated list");
