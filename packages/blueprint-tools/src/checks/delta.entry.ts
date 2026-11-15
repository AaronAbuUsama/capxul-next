// `pnpm delta:check`: prints each finding of the delta check (delta.ts), one a line, and fails when there is one.
import { deltaCheck } from "./delta.ts";

const findings = deltaCheck();
for (const { operation, format, reason } of findings) console.error(`${operation} (${format}): ${reason}`);
if (findings.length > 0) {
  console.error(`delta check: ${findings.length} finding(s)`);
  process.exitCode = 1;
} else console.log("delta check: every operation has every format, or is on its unmigrated list");
