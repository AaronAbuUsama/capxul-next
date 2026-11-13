import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Database } from "@capxul/backend/devnet";
import { readWorldCompanies } from "@capxul/backend/organizations";
import { worldCatalogue, type RecordFilter } from "./catalogue.ts";
import { psqlAdmin } from "./postgres.ts";
import { databaseUrl, type Config } from "./supervisor.ts";

/** Public query views deliberately exclude storage paths and the recorder's private columns. */
const entryView = (r: Record<string, unknown>) => ({
  worldId: r.world_id, epoch: r.epoch, seq: r.seq, kind: r.kind, worldTime: Date.parse(String(r.world_time)),
  realTime: Date.parse(String(r.real_time)), who: r.actor_email ?? r.actor_address ?? "system", hats: r.actor_hats,
  surface: r.surface ?? "unknown", traceId: r.trace_id, command: r.command, outcome: r.outcome, code: r.error_code,
  causeSeq: r.cause_seq, branchAbandoned: r.branch_abandoned,
});

const snapshotViews = (rows: Record<string, unknown>[]) => rows.map((s) => ({
  name: s.name, worldId: s.world_id, epoch: s.epoch, recordSeq: s.record_seq, clockMode: s.clock_mode,
  rate: s.rate, worldNow: s.world_now, template: s.template, createdAt: s.created_at, sites: (s.site_backups as unknown[]).length,
}));

/** The selected world's snapshots, newest first, as declared SnapshotViews. Read-only: no lock, composition or running process. */
export async function listSnapshots(c: Config) {
  return (await readCatalogue(c, ["world", "snapshot", "list"]) as { snapshots: ReturnType<typeof snapshotViews> }).snapshots;
}

/** Does not compose, migrate, acquire a mutation lock, or require any world process to be running. */
export async function readCatalogue(c: Config, words: string[]): Promise<unknown> {
  const snapshot = words.slice(0, 3).join(" ") === "world snapshot list";
  const worldShow = words.slice(0, 2).join(" ") === "world show";
  const verb = snapshot ? "snapshots" : worldShow ? "world" : words[1];
  if (!snapshot && !worldShow && (words[0] !== "record" || !["list", "show", "export"].includes(verb!))) throw new Error("CLI_USAGE: expected record list|show|export");
  const rest = words.slice(snapshot ? 3 : 2);
  if ((snapshot || worldShow) && rest[0] && !rest[0].startsWith("--")) {
    if (rest.shift() !== c.world.id) throw new Error("INVALID_INPUT: world does not match the private config");
  }
  const allowed = verb === "list" ? ["world", "who", "kind", "from", "to", "trace", "epoch", "limit", "include-abandoned"] :
    verb === "show" ? ["world", "epoch", "seq"] : verb === "export" ? ["world", "from", "to", "out"] : ["world"];
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const name = rest[i]!.startsWith("--") ? rest[i]!.slice(2) : "";
    if (!allowed.includes(name) || flags.has(name)) throw new Error("CLI_USAGE: unknown or duplicate catalogue option");
    const value = name === "include-abandoned" ? "true" : rest[++i];
    if (!value || value.startsWith("--")) throw new Error("CLI_USAGE: catalogue option requires a value");
    flags.set(name, value);
  }
  if (flags.has("world") && flags.get("world") !== c.world.id) throw new Error("INVALID_INPUT: world does not match the private config");
  const filter: RecordFilter = {};
  for (const key of ["epoch", "from", "to", "limit"] as const) if (flags.has(key)) {
    const value = flags.get(key)!;
    if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value)) ||
        (["epoch", "limit"].includes(key) && Number(value) < 1)) throw new Error(`INVALID_INPUT: invalid ${key}`);
    filter[key] = Number(value);
  }
  if (filter.limit !== undefined && filter.limit > 10000) throw new Error("INVALID_INPUT: invalid record limit");
  if (filter.from !== undefined && filter.to !== undefined && filter.from > filter.to) throw new Error("INVALID_INPUT: time range is reversed");
  for (const key of ["from", "to"] as const) if (filter[key] !== undefined && !Number.isFinite(new Date(filter[key]!).getTime())) throw new Error(`INVALID_INPUT: invalid ${key}`);
  for (const key of ["who", "kind", "trace"] as const) if (flags.has(key)) filter[key] = flags.get(key)!;
  if (flags.has("include-abandoned")) filter.includeAbandoned = true;
  const sequence = flags.get("seq");
  if (verb === "show" && (!sequence || !/^\d+$/.test(sequence) || !Number.isSafeInteger(Number(sequence)) || Number(sequence) < 1)) throw new Error("INVALID_INPUT: show requires a positive --seq");
  if (verb === "export" && !flags.has("out")) throw new Error("CLI_USAGE: export requires --out FILE");
  const url = new URL(c.database.tenant);
  if (decodeURIComponent(url.username) !== "capxul_core") throw new Error("INVALID_INPUT: restricted catalogue reader required");
  const query = psqlAdmin(databaseUrl(url.href, c.world));
  const store = worldCatalogue(async (sql) => {
    try { return await query(sql); }
    catch (cause) { throw new Error("Catalogue query failed; inspect private world diagnostics", { cause }); }
  }, []);
  const world = c.world.id;
  if (verb === "world") {
    const { world: w, cut } = await store.view(world);
    const companies = await worldCompanies(c);
    return { worldId: w.world_id, name: w.name, kind: w.kind, profile: w.profile, address: w.address, state: w.state, clockMode: w.clock_mode,
      rate: w.rate, worldNow: w.world_now, epoch: w.epoch, chainId: w.chain_id, hosted: w.hosted, parentWorld: w.parent_world,
      parentSnapshot: w.parent_snapshot, parentSeq: w.parent_seq,
      // The configured native route, not proof of DNS, a listener or HTTP readiness.
      companies: companies.map((o) => ({ orgId: o.orgId, name: o.name, url: o.site === null ? null : `http://${o.site}:${c.ports.publicBench}` })),
      recordHead: cut.seq };
  }
  // An absent world must not become an empty successful list or a synthetic birth.
  const row = await store.show(world);
  if (verb === "snapshots") return { snapshots: snapshotViews(await store.snapshots(world)) };
  if (verb === "list") return { entries: (await store.records(world, filter)).map(entryView) };
  if (verb === "show") {
    const r = await store.record(world, filter.epoch ?? row.epoch, Number(sequence));
    return { entry: entryView(r), args: r.args, returned: r.result, changed: r.changes, pointers: null };
  }
  const { data, ...result } = await store.export(world, filter);
  try { await writeFile(resolve(flags.get("out")!), data, { flag: "wx", mode: 0o600 }); }
  catch (cause) { throw new Error("Record export could not create a new private output file", { cause }); }
  return result;
}

/** Organizations' complete inventory; config.sites and financial records never stand in for company identity. */
async function worldCompanies(c: Config) {
  const db = new Database(databaseUrl(c.database.tenant, c.world), databaseUrl(c.database.worker, c.world));
  try {
    const client = await db.worker.connect();
    try { return await readWorldCompanies(client); } finally { client.release(); }
  } catch (cause) { throw new Error("World company inventory is unavailable; inspect private world diagnostics", { cause }); }
  finally { await db.close(); }
}
