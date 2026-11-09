// node --experimental-strip-types tools/report-surface.ts [--md]
// The command surface (books/target/shared/surface.ts, decision surface.tree) against the book: every operation once in
// SURFACE, and every row spelt in the book as its `next` once its owner has applied it. Prints each row still to apply
// and each mismatch, and exits 1 on a mismatch (an operation in no row, a row matching no operation, a command twice).
// Rows still to apply are reported, not failed, so the check runs before and after the owners apply the moves.
// With --md, prints the per-group command tables of docs/design/command-surface.md section 6 instead.

import * as fs from "node:fs";
import * as path from "node:path";
import { frozen } from "../books/frozen/operations.ts";
import { SURFACE, SURFACE_GROUPS } from "../books/target/shared/surface.ts";

type Op = { _kind: string; id: string; command: string };
const root = path.join(import.meta.dirname, "..", "books", "target");
const concepts = fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, "operations.ts")));
const ops: (Op & { concept: string })[] = [];
for (const c of concepts) {
  const m = (await import(path.join(root, c, "operations.ts"))) as Record<string, unknown>;
  for (const v of Object.values(m)) {
    const o = v as Op;
    if (o && typeof o === "object" && o._kind === "operation") ops.push({ ...o, concept: c });
  }
}

const isFrozen = (id: string) => id in frozen;
const words = (command: string) => command.trim().split(/\s+/).join(".");
const problems: string[] = [];
const pending: string[] = [];
const matched = new Map<(typeof SURFACE)[number], (typeof ops)[number]>();

for (const o of ops) {
  // A frozen operation keeps its id; a new one is found by its command, before or after the move.
  const rows = SURFACE.filter((r) => (isFrozen(o.id) ? r.id === o.id : r.now === o.command || r.next === o.command));
  if (rows.length !== 1) { problems.push(`${o.id} (${o.command}): in ${rows.length} rows of SURFACE; it must be in one`); continue; }
  const r = rows[0]!;
  if (matched.has(r)) { problems.push(`row "${r.now}" matches ${matched.get(r)!.id} and ${o.id}`); continue; }
  matched.set(r, o);
  if (o.command !== r.next) pending.push(`${o.concept}: ${o.id} "${o.command}" → "${r.next}"${isFrozen(o.id) ? "" : ` (id ${words(r.next)})`}`);
  else if (!isFrozen(o.id) && o.id !== words(r.next)) problems.push(`${o.id}: spelt "${r.next}", so its id is ${words(r.next)}`);
}
for (const r of SURFACE) if (!matched.has(r)) problems.push(`row "${r.now}" → "${r.next}" matches no operation`);

if (process.argv.includes("--md")) {
  for (const g of SURFACE_GROUPS) {
    const rows = SURFACE.filter((r) => r.group === g.id);
    console.log(`### ${g.title} (${rows.length})\n`);
    console.log("| Operation | Command as booked | Command in the tree | Owner |");
    console.log("|---|---|---|---|");
    for (const r of rows) {
      const o = matched.get(r);
      const id = isFrozen(r.id) ? r.id : words(r.next);
      const moved = r.now !== r.next ? `**\`${r.next}\`**` : `\`${r.next}\``;
      console.log(`| \`${id}\`${isFrozen(r.id) ? "" : " (new)"} | \`${r.now}\` | ${moved} | ${o?.concept ?? "?"} |`);
    }
    console.log("");
  }
} else {
  const moved = SURFACE.filter((r) => r.now !== r.next);
  console.log(
    `Surface: ${SURFACE.length} rows for ${ops.length} operations in ${SURFACE_GROUPS.length} groups; ${moved.length} moves ` +
      `(${moved.filter((r) => isFrozen(r.id)).length} of the 215, ${moved.filter((r) => !isFrozen(r.id)).length} new); ` +
      `${pending.length} still to apply.`,
  );
  for (const p of pending) console.log(`to apply ${p}`);
  console.log(`${problems.length} problems.`);
  for (const p of problems) console.log(`problem ${p}`);
  process.exitCode = problems.length ? 1 : 0;
}
