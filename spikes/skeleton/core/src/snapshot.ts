// World snapshots: `world snapshot save|list|restore`. A snapshot is ONE folder, core/state/snapshots/<id>/, versioned and self-describing:
//   manifest.json          schema, id, name, the world, when (real and world time), the clock, the position in the record, sizes, checksums,
//                          every company's site summary (documents, ledger balances, hats, features), what a restore rewrites and cannot
//   chain/anvil-state.json the WHOLE chain of the world (one anvil is one world; it cannot be split by company, which is why a world is the unit)
//   core/                  Core's state for the world: outbox, approvals, cursor, deployment, clock, tx-trace, and the record up to the snapshot
//   sites/<company>/       bench's own backup of each company's site: database dump, public and private files, site_config
// Restore `--into <world>` makes a second world beside the first (its own anvil, Core, state and sites); `--in-place` puts this world back.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { parseArgs } from "./args.ts";
import { publicClient } from "./chain.ts";
import { bench, companies, requireOperator } from "./clock.ts";
import { config, coreDir, skeletonDir } from "./config.ts";
import { core } from "./cli.ts";
import type { Out } from "./doc.ts";
import { CliError, refuse } from "./errors.ts";
import { appendTo, readAll, recordDir, verifyChain, setRecordSlug } from "./record.ts";
import { show } from "./render.ts";
import { touched } from "./trace.ts";
import { offsetMs, setOffset, world, worldIso } from "./world.ts";
import { nextPorts, readRegistry, register, startWorld, stopWorld, validName, type W } from "./worldcmd.ts";
void setRecordSlug;

const exec = promisify(execFile);
const root = join(coreDir, "state", "snapshots");
const CORE_FILES = ["outbox.json", "cursor.json", "approvals.json", "deployment.json", "clock.json", "tx-trace.jsonl", "v4-orgs.json"];
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const size = (p: string): number => (statSync(p).isDirectory() ? readdirSync(p).reduce((n, f) => n + size(join(p, f)), 0) : statSync(p).size);
const siteName = (w: string, c: string) => (w === "main" ? `${c}.localhost` : `${c}.${w}.localhost`);
const script = (n: string) => join(skeletonDir, "frappe", "bin", n);
const cp = (from: string, to: string) => { mkdirSync(join(to, ".."), { recursive: true }); if (existsSync(from)) copyFileSync(from, to); };

// What a restore rewrites for a new world, and what it cannot (written into every manifest).
export const REWRITES = [
  "site name: <company>.localhost -> <company>.<world>.localhost (bench makes a new site and restores the dump into it)",
  "site_config.json: capxul_world, host_name (http://<site>:8000); encryption_key kept from the backup (passwords in the database are encrypted with it)",
  "Capxul Settings.core_url: the new world's Core (host.docker.internal:<port>)",
  "Social Login Key capxul: base_url, authorize_url, access_token_url, api_endpoint (the new world's Core, as the browser and as the bench reach it)",
  "the world's clock: the new world resumes at the saved world time (offset recomputed against the host's time now), on the chain, in the bench's world-clock file and in Core",
  "Core: its own state directory and port; the outbox keeps its cursor; org ids on the chain are unchanged (the chain is a copy, same contracts, same addresses)",
];
export const CANNOT = [
  "creation/modified stamps and posting dates keep the saved world's dates (they are history); only 'now' is rebased",
  "host-time things in the site: Redis (cache, sessions, queued jobs) is not in a snapshot, so browser sessions end and queued jobs are lost; tabSessions rows are restored but stale",
  "email and file URLs that stored an absolute http://<old site>:8000 inside document bodies or File rows (not found in the spike's data, but nothing rewrites them)",
  "the test people's keys and the shared secret are configuration (people.json, .env), not world state, so a snapshot does not hold them",
  "a real chain cannot be copied this way: this is anvil's state dump",
];

async function quiet(): Promise<void> {
  for (const c of companies()) {
    for (let i = 0; i < 100; i++) { if (!(await core("/admin/status", { slug: c })).pending.length) break; await new Promise((r) => setTimeout(r, 300)); if (i === 99) throw new CliError(`${c} still has events undelivered: a snapshot needs a quiet world`, "NOT_QUIET"); }
  }
}
// anvil's own dump: gzip of its state as hex in the RPC answer; unzipped it is the JSON file `anvil --state <file>` loads back
async function dumpChain(to: string): Promise<number> {
  const hex: string = await (publicClient as any).request({ method: "anvil_dumpState", params: [] });
  mkdirSync(join(to, ".."), { recursive: true });
  const buf = gunzipSync(Buffer.from(hex.slice(2), "hex"));
  writeFileSync(to, buf);
  return buf.length;
}

const manifestOf = (id: string) => {
  const p = join(root, id, "manifest.json");
  if (!existsSync(p)) throw refuse("NOT_FOUND", `no snapshot ${id}; see: world snapshot list`);
  return JSON.parse(readFileSync(p, "utf8"));
};

export async function snapshotSave(args: string[]): Promise<Out> {
  const { pos, flags } = parseArgs(args);
  requireOperator(typeof flags.as === "string" ? flags.as : undefined, "world snapshot save <world> [--name <label>]");
  if (!pos[0]) throw refuse("USAGE", "usage: world snapshot save <world> --as operator [--name <label>]");
  const t0 = Date.now(), cos = companies();
  await quiet();
  const id = `snap_${world}_${Date.now().toString(36)}`, dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  const chainBytes = await dumpChain(join(dir, "chain", "anvil-state.json"));
  for (const f of CORE_FILES) cp(join(config.stateDir, f), join(dir, "core", f));
  cp(join(recordDir, `${world}.jsonl`), join(dir, "core", "record", `${world}.jsonl`));
  const rec = verifyChain(world);
  const sites = await Promise.all(cos.map(async (c) => {
    const site = siteName(world, c);
    const { stdout } = await exec(script("site-backup.sh"), [site, join(dir, "sites", c)], { maxBuffer: 1 << 26, timeout: 20 * 60_000 }).catch((e) => { throw new CliError(`backup of ${site} failed: ${String(e.stderr || e.message).slice(-300)}`, "BACKUP_FAILED"); });
    return { company: c, site, files: stdout.trim().split("\n"), bytes: size(join(dir, "sites", c)), summary: await bench(site, "capxul.world.summary", {}) };
  }));
  const manifest = { schema: "capxul-world-snapshot/1", id, name: typeof flags.name === "string" ? flags.name : id, world, savedAtReal: new Date().toISOString(), savedAtWorld: worldIso(), offsetMs: offsetMs(),
    from: readRegistry()[world]?.from ?? null, record: { file: `core/record/${world}.jsonl`, count: rec.count, headSha256: rec.head, chainOk: rec.ok },
    chain: { file: "chain/anvil-state.json", bytes: chainBytes, sha256: sha(join(dir, "chain", "anvil-state.json")), scope: "the whole chain of the world (every company on it)" },
    core: { files: CORE_FILES.filter((f) => existsSync(join(dir, "core", f))) }, sites, rewrites: REWRITES, cannotRewrite: CANNOT, bytes: size(dir), ms: Date.now() - t0 };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  touched.extra.snapshot = { id, record: manifest.record };
  return { data: { id, name: manifest.name, world, bytes: manifest.bytes, ms: manifest.ms, companies: cos, record: manifest.record }, lines: [`saved ${id} (${manifest.name}): world ${world} at ${manifest.savedAtWorld}, ${cos.length} companies, record position ${rec.count}, ${(manifest.bytes / 1e6).toFixed(1)} MB, ${manifest.ms} ms`] };
}

export async function snapshotList(args: string[]): Promise<Out> {
  const { pos } = parseArgs(args);
  const ids = existsSync(root) ? readdirSync(root).filter((d) => existsSync(join(root, d, "manifest.json"))) : [];
  const rows = ids.map((i) => JSON.parse(readFileSync(join(root, i, "manifest.json"), "utf8"))).filter((m) => !pos[0] || m.world === pos[0])
    .map((m) => ({ id: m.id, name: m.name, world: m.world, savedAtWorld: m.savedAtWorld.slice(0, 19), companies: m.sites.map((s: any) => s.company).join(","), record: m.record.count, mb: +(m.bytes / 1e6).toFixed(1) }));
  return { data: { snapshots: rows }, lines: [`${rows.length} snapshots`, ...show(rows)] };
}

export async function snapshotRestore(args: string[]): Promise<Out> {
  const { pos, flags } = parseArgs(args);
  if (!pos[0]) throw refuse("USAGE", "usage: world snapshot restore <snapshot id> --as operator (--into <new world> [--only <company>] | --in-place)");
  requireOperator(typeof flags.as === "string" ? flags.as : undefined, "world snapshot restore <id>");
  const m = manifestOf(pos[0]), dir = join(root, m.id);
  if (sha(join(dir, m.chain.file)) !== m.chain.sha256) throw new CliError(`snapshot ${m.id}: the chain file does not match its checksum`, "CORRUPT");
  const into = typeof flags.into === "string" ? flags.into : undefined, inPlace = flags["in-place"] === true;
  if (!!into === inPlace) throw refuse("USAGE", "give exactly one of --into <new world> and --in-place");
  const only = typeof flags.only === "string" ? flags.only.split(",") : undefined;
  const cos: string[] = m.sites.map((s: any) => s.company).filter((c: string) => !only || only.includes(c));
  const t0 = Date.now(), phases: Record<string, number> = {}, lap = (k: string, t: number) => { phases[k] = Date.now() - t; };
  const savedMs = Date.parse(m.savedAtWorld), newOffset = savedMs - Date.now();
  let w: W, target: string;
  const srcWorld = m.world as string;
  if (into) {
    validName(into);
    if (readRegistry()[into]) throw refuse("EXISTS", `world ${into} already exists; restore into a name that is new, or use --in-place`);
    target = into;
    w = { name: into, stateDir: join(coreDir, "state", "worlds", into), ...nextPorts(), createdAt: new Date().toISOString(), from: { snapshot: m.id, world: srcWorld, record: m.record, savedAtWorld: m.savedAtWorld } };
    mkdirSync(w.stateDir, { recursive: true });
    register(w);
  } else {
    target = srcWorld;
    w = readRegistry()[srcWorld]!;
    if (!w) throw refuse("NOT_FOUND", `world ${srcWorld} is not registered here`);
    await stopWorld(w);
  }
  let t = Date.now();
  // the chain and Core
  copyFileSync(join(dir, m.chain.file), join(w.stateDir, "anvil-state.json"));
  for (const f of m.core.files) cp(join(dir, "core", f), join(w.stateDir, f));
  const ob = JSON.parse(readFileSync(join(w.stateDir, "outbox.json"), "utf8"));
  for (const k of Object.keys(ob.orgs)) if (!cos.includes(k)) delete ob.orgs[k];   // only the restored companies have a site here
  writeFileSync(join(w.stateDir, "outbox.json"), JSON.stringify(ob, null, 2));
  writeFileSync(join(w.stateDir, "clock.json"), JSON.stringify({ offsetMs: newOffset, changedAt: new Date().toISOString() }));
  if (into) {   // the new world's record begins with the old world's, up to the snapshot, then says where it came from
    mkdirSync(join(w.stateDir, "record"), { recursive: true });
    copyFileSync(join(dir, "core", "record", `${srcWorld}.jsonl`), join(w.stateDir, "record", `${target}.jsonl`));
  }
  lap("chain+core files", t); t = Date.now();
  if (into) {
    const lineage = { snapshot: m.id, fromWorld: srcWorld, fromRecord: m.record, savedAtWorld: m.savedAtWorld, companies: cos };
    appendTo(join(w.stateDir, "record", `${target}.jsonl`), { v: 1, id: `rec_restore_${Date.now().toString(36)}`, command: "world snapshot restore", world: target, org: null, outcome: "ok",
      trace: `restore_${Date.now().toString(36)}`, args: { positional: [m.id], flags: { into: target } },
      actor: null, site: null, world_time_end: new Date(savedMs).toISOString(), duration_ms: Date.now() - t0,
      error: null, result: null, changes: { tx: [], docs: [] },
      note: "this world was made from a snapshot: its record up to here is the snapshot's world's record", lineage, world_time: new Date(savedMs).toISOString(), real_time: new Date().toISOString() });
  }
  await startWorld(w);
  lap("start chain and Core", t); t = Date.now();
  const coreUrl = `http://host.docker.internal:${w.corePort}`, browserUrl = `http://localhost:${w.corePort}`;
  const sites = await Promise.all(cos.map(async (c) => {
    const site = siteName(target, c), ts = Date.now();
    await exec(script("site-restore.sh"), [site, join(dir, "sites", c)], { maxBuffer: 1 << 26, timeout: 30 * 60_000 }).catch((e) => { throw new CliError(`restore of ${site} failed: ${String(e.stderr || e.message).slice(-300)}`, "RESTORE_FAILED"); });
    const rewritten = await bench(site, "capxul.world.rewrite", { world: target, core_url: coreUrl, browser_core_url: browserUrl, site });
    return { company: c, site, rewritten, ms: Date.now() - ts };
  }));
  lap("sites", t); t = Date.now();
  await bench(siteName(target, cos[0]!), "capxul.clock.write_world", { world: target, offset_ms: newOffset });
  lap("clock", t);
  touched.extra.lineage = { snapshot: m.id, fromWorld: srcWorld, intoWorld: target, recordPosition: m.record };
  const data = { snapshot: m.id, into: into ?? null, inPlace, world: target, companies: cos, sites: sites.map((s) => ({ site: s.site, ms: s.ms, rewritten: Object.keys(s.rewritten) })), time: new Date(savedMs).toISOString(), phasesMs: phases, ms: Date.now() - t0, rewrites: REWRITES, cannotRewrite: CANNOT };
  return { data, lines: [`restored ${m.id} ${into ? `into new world ${into} (chain :${w.anvilPort}, Core :${w.corePort})` : `in place in world ${target}`}: ${cos.join(", ")} at world time ${data.time}, ${data.ms} ms (${Object.entries(phases).map(([k, v]) => `${k} ${v}`).join(", ")})`] };
}
