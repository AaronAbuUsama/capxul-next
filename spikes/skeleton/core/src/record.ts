// The recorder. One wide event per command, appended to state/record/<slug>.jsonl when the command finishes, written by main.ts, the single
// entry point: a command cannot run without going through it (an exit handler writes a "failed" record if the process dies first).
//
// A record: id, trace id, command + arguments, who (email, chain address) under which hats, org and site, the world's time and the real
// time, duration, outcome (ok | refused | failed with code and reason), the result, and what changed (chain transactions, Frappe
// documents). Each line also carries `seq` and `prev`, the sha256 of the previous line, so a file that was edited or cut is detectable.
//
// No secret is ever written. How: (1) the record is built from named fields, never from the environment; (2) every value under a key that
// looks like a secret (secret, password, token, key, authorization, assertion) is replaced; (3) every secret this process knows by value
// (the shared secret, every test key, each with and without 0x) is replaced wherever it appears in the text; (4) a last check refuses to
// write the line if any of those values is still in it. Hashes are kept (a key and a transaction hash look alike, so this is by value).
import { createHash, randomBytes } from "node:crypto";
import { Schema } from "effect";
import { CommandRecordEntry } from "../../../../blueprint/devnet/record-entry.ts";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import type { Address } from "viem";
import { config } from "./config.ts";
import { CliError } from "./errors.ts";
import { operatorKey, people, byEmail } from "./people.ts";
import { touched, trace } from "./trace.ts";
import { siteOf, world, worldIso } from "./world.ts";

export const HATS = ["admin", "budget-holder", "payroll-approver", "member", "sales", "hr-manager", "project-manager"];
export const recordDir = `${config.stateDir}/record`;
const dir = recordDir;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const SECRET_KEY = /secret|password|passwd|token|api.?key|private.?key|authorization|assertion|^key$/i;
const MAX_RESULT = 30_000;

const secrets = (): string[] => [config.secret, operatorKey, ...people.map((p) => p.privateKey)].flatMap((s) => (s ? [s, s.replace(/^0x/, "")] : []));
function scrub(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEY.test(k) && x ? "[redacted]" : scrub(x)]));
  return v;
}
function line(rec: Record<string, unknown>): string {
  let text = JSON.stringify(scrub(rec));
  for (const s of secrets()) text = text.split(s).join("[redacted]");
  if (secrets().some((s) => text.includes(s))) throw new Error("recorder: a secret would be written; refusing");
  return text;
}

export type Begin = { command: string; argv: string[]; slug?: string; flags: Record<string, string | true>; pos: string[] };
let begun: (Begin & { t0: number; realStart: string; worldStart: string; hatsAtStart?: string[] }) | undefined;
let written = false;
// a command that makes a world (restore --into) tells the recorder which file the record belongs in
export const setRecordSlug = (slug: string): void => { if (begun) begun.slug = slug; };

async function hatsOf(slug: string | undefined, email: string | undefined): Promise<string[]> {
  const p = email ? byEmail(email) : undefined;
  if (!slug || !p) return [];
  try {
    // Offline commands have no hats to query. Do not load viem or compiled
    // contract artifacts until an actor and organization actually need them.
    const { wears } = await import("./chain.ts");
    const worn = await Promise.all(HATS.map((h) => wears(slug, p.address as Address, h)));
    return HATS.filter((_, i) => worn[i]);
  } catch { return []; }
}

export async function begin(b: Begin): Promise<void> {
  touched.org = b.slug;
  const asEmail = typeof b.flags.as === "string" ? b.flags.as : typeof b.flags.admin === "string" ? b.flags.admin : undefined;
  begun = { ...b, t0: Date.now(), realStart: new Date().toISOString(), worldStart: worldIso(), hatsAtStart: asEmail ? await hatsOf(b.slug, asEmail) : undefined };
  process.on("exit", () => { if (!written && begun) { try { writeSync(blank("failed", { code: "TERMINATED", reason: "the process ended before the command finished" }, undefined)); } catch { /* nothing more can be done */ } } });
}

const blank = (outcome: string, error: unknown, result: unknown): Record<string, unknown> => {
  const b = begun!;
  const email = (typeof b.flags.as === "string" ? b.flags.as : undefined) ?? (typeof b.flags.admin === "string" ? b.flags.admin : undefined) ?? touched.actor;
  const p = email ? byEmail(email) : undefined;
  let res: unknown = result;
  if (res !== undefined && JSON.stringify(res).length > MAX_RESULT) res = { truncated: true, bytes: JSON.stringify(res).length, head: JSON.stringify(res).slice(0, 2000) };
  return {
    v: 1, id: `rec_${b.t0.toString(36)}${randomBytes(4).toString("hex")}`, trace, command: b.command,
    args: { positional: b.pos, flags: b.flags },
    actor: email ? { email, address: p?.address ?? null, hats: b.hatsAtStart ?? [] } : null,
    world, org: b.slug ?? null, site: b.slug ? siteOf(b.slug) : null,
    world_time: b.worldStart, world_time_end: worldIso(), real_time: b.realStart, duration_ms: Date.now() - b.t0,
    outcome, error: outcome === "ok" ? null : error, result: res ?? null,
    changes: { tx: touched.tx, docs: touched.docs, ...touched.extra },
  };
};

function lock(path: string): () => void {
  const l = `${path}.lock`;
  for (let i = 0; i < 400; i++) {
    try { closeSync(openSync(l, "wx")); return () => { try { unlinkSync(l); } catch { /* gone */ } }; }
    catch { try { if (Date.now() - statSync(l).mtimeMs > 10_000) unlinkSync(l); } catch { /* raced */ } Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25); }
  }
  throw new Error("recorder: could not lock " + l);
}
// Append one record to a record file (also used to start a restored world's record). Under a lock; numbers and chains it.
export function appendTo(path: string, rec: Record<string, unknown>): void {
  mkdirSync(path.replace(/\/[^/]*$/, ""), { recursive: true });
  const unlock = lock(path);
  try {
    let seq = 1, prev = "0".repeat(64);
    if (existsSync(path)) { const last = readFileSync(path, "utf8").trimEnd().split("\n").pop()!; if (last) { seq = JSON.parse(last).seq + 1; prev = sha(last); } }
    const serialized = line({ ...rec, seq, prev });
    // Validate the redacted bytes, retaining extension fields (lineage, domain pointers).
    // Never decode into a narrower object: that would silently drop training data.
    Schema.decodeUnknownSync(CommandRecordEntry)(JSON.parse(serialized));
    appendFileSync(path, serialized + "\n");
  } finally { unlock(); }
}
function writeSync(rec: Record<string, unknown>): void {
  written = true;
  appendTo(`${dir}/${world}.jsonl`, rec);
}

export async function finish(r: { ok: true; result: unknown } | { ok: false; error: unknown }): Promise<Record<string, unknown>> {
  let rec: Record<string, unknown>;
  if (r.ok) rec = blank("ok", null, r.result);
  else {
    const e = r.error;
    const err = e instanceof CliError ? { code: e.code, reason: e.message, detail: e.detail ?? null } : { code: "INTERNAL", reason: (e as Error)?.message ?? String(e), detail: null };
    rec = blank(e instanceof CliError && e.refused ? "refused" : "failed", err, undefined);
  }
  const a = rec.actor as { email: string; hats: string[] } | null;
  if (a && !a.hats.length) a.hats = await hatsOf(begun!.slug, a.email);
  writeSync(rec);
  return rec;
}

// ---- reading: record tail | show | export --------------------------------------------------------------------------------------
const files = () => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".jsonl")) : []);
export const readAll = (slug: string, org?: string): any[] => {
  const p = `${dir}/${slug}.jsonl`;
  return existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !org || r.org === org) : [];
};
export function findRecord(id: string): any {
  for (const f of files()) for (const l of readFileSync(`${dir}/${f}`, "utf8").split("\n")) if (l.includes(id)) { const r = JSON.parse(l); if (r.id === id || r.trace === id) return r; }
  return undefined;
}
export function verifyChain(slug: string): { ok: boolean; count: number; head: string } {
  const lines = existsSync(`${dir}/${slug}.jsonl`) ? readFileSync(`${dir}/${slug}.jsonl`, "utf8").split("\n").filter(Boolean) : [];
  let prev = "0".repeat(64), ok = true;
  lines.forEach((l, i) => { const r = JSON.parse(l); if (r.seq !== i + 1 || r.prev !== prev) ok = false; prev = sha(l); });
  return { ok, count: lines.length, head: prev };
}
/** `lineage` names the world this one was restored from (null for a world that was born here); it is the export's first line. */
export function exportRecord(slug: string, out?: string, org?: string, lineage: Record<string, unknown> | null = null): { path: string; count: number; lines: number; chainOk: boolean; lineage: Record<string, unknown> | null } {
  const v = verifyChain(slug);
  const path = out ?? `${dir}/export/${slug}-${worldIso().replace(/[:.]/g, "")}.jsonl`;
  mkdirSync(path.replace(/\/[^/]*$/, ""), { recursive: true });
  const head = { type: "capxul-record-export", schema: 1, slug, lineage, exported_at: new Date().toISOString(), world_time: worldIso(), count: v.count, chain_ok: v.ok, head_sha256: v.head };
  const entries = readAll(slug, org);
  writeFileSync(path, [line(head), ...entries.map((r) => line(r))].join("\n") + "\n");
  return { path, count: v.count, lines: entries.length + 1, chainOk: v.ok, lineage };
}
