// record tail | show | export
import { parseArgs } from "./args.ts";
import { refuse } from "./errors.ts";
import type { Out } from "./doc.ts";
import { exportRecord, findRecord, readAll, verifyChain } from "./record.ts";
import { table } from "./render.ts";

export async function recordTail(args: string[]): Promise<Out> {
  const { pos, flags } = parseArgs(args);
  if (!pos[0]) throw refuse("USAGE", "usage: record tail <world> [--org <company>] [--n 20]");
  const rows = readAll(pos[0], typeof flags.org === "string" ? flags.org : undefined).slice(-Number(flags.n ?? 20));
  const v = verifyChain(pos[0]);
  return { data: { count: v.count, chainOk: v.ok, records: rows }, lines: [`${v.count} records for ${pos[0]}${v.ok ? "" : " (CHAIN BROKEN)"}`,
    ...table(rows.map((r) => ({ seq: r.seq, company: r.org ?? "", world: String(r.world_time).slice(0, 19), who: r.actor?.email ?? "", command: r.command, outcome: r.outcome, code: r.error?.code ?? "", ms: r.duration_ms, id: r.id })))] };
}
export async function recordShow(args: string[]): Promise<Out> {
  const { pos } = parseArgs(args);
  if (!pos[0]) throw refuse("USAGE", "usage: record show <record id or trace id>");
  const r = findRecord(pos[0]);
  if (!r) throw refuse("NOT_FOUND", `no record ${pos[0]}`);
  return { data: r, lines: JSON.stringify(r, null, 2).split("\n") };
}
export async function recordExport(args: string[]): Promise<Out> {
  const { pos, flags } = parseArgs(args);
  if (!pos[0]) throw refuse("USAGE", "usage: record export <world> [--org <company>] [--out <file>]");
  const e = exportRecord(pos[0], typeof flags.out === "string" ? flags.out : undefined, typeof flags.org === "string" ? flags.org : undefined);
  return { data: e, lines: [`${e.count} records of ${pos[0]} in ${e.path} (hash chain ${e.chainOk ? "intact" : "BROKEN"})`] };
}
