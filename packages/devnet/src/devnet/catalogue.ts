import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isCredentialField, redactSecrets } from "@capxul/sdk";
import type { Admin } from "./door.ts";

export type WorldRow = {
  world_id: string; name: string; kind: "local" | "simulated" | "staging" | "production"; profile: "core" | "full";
  address: string | null; template: string | null; chain_id: number; chain_instance: string;
  clock_mode: "frozen" | "running"; rate: number; world_now: number; epoch: number;
  parent_world: string | null; parent_snapshot: string | null; parent_seq: number | null; hosted: boolean;
  state: "creating" | "running" | "stopped" | "restoring" | "parked" | "closed"; created_at: number; updated_at: number;
};
export type Command = {
  trace: string; command: string | null; args?: unknown; kind?: "command" | "tool-call" | "reply" | "born" | "restore" | "clock" | "event" | "join" | "handover" | "score";
  actor?: { email: string; address: string | null; hats: string[]; kind: "person" | "agent" };
  org?: string; site?: string; worldTime: number; worldTimeEnd?: number; realTime?: number; durationMs?: number;
  outcome: "ok" | "refused" | "failed"; error?: { code: string; reason: string; detail?: unknown };
  result?: unknown; changes?: Record<string, unknown>; run?: string; model?: string; policyVersion?: string;
  surface?: "cli" | "sdk" | "mcp" | "http" | "workflow"; causeSeq?: number;
};
export type SnapshotRow = {
  world_id: string; name: string; epoch: number; record_seq: number; chain_state_ref: string;
  site_backups: { org_id: string; backup_ref: string }[]; clock_mode: "frozen" | "running"; rate: number;
  world_now: number; code_version: string; template: boolean; created_at: number;
};
export type RecordFilter = { epoch?: number; who?: string; kind?: string; from?: number; to?: number; trace?: string; includeAbandoned?: boolean; limit?: number };
export type CatalogueCut = { epoch: number; seq: number; head: string };
export type CatalogueHistory = { lineage: { parentWorld: string | null; parentSnapshot: string | null; parentSeq: number | null }; cut: CatalogueCut; records: Record<string, unknown>[]; snapshots: SnapshotRow[] };
export type RestoreCatalogue = { sourceWorld: string; snapshot: string; cut: CatalogueCut; abandoned?: CatalogueHistory };
const text = (value: string) => `'${value.replaceAll("'", "''")}'`;
const json = (value: unknown) => `${text(JSON.stringify(value))}::jsonb`;
const hash = (alias: string) => `encode(sha256(convert_to((to_jsonb(${alias}) - 'branch_abandoned')::text,'UTF8')),'hex')`;
const assertWorld = (id: string) => { if (!/^[a-z][a-z0-9]{0,11}$/.test(id)) throw new Error("INVALID_INPUT: invalid world id"); };
const lock = (world: string) => `DO $lock$ BEGIN PERFORM pg_advisory_xact_lock(hashtextextended(${text(world)},0)); END $lock$;`;
const rows = (table: string, value: unknown) => `jsonb_populate_record(NULL::app.${table},${json(value)})`;
const requireWorld = (world: string) => `DO $world$ BEGIN IF NOT EXISTS (SELECT FROM app.worlds WHERE world_id=${text(world)}) THEN RAISE EXCEPTION 'INVALID_INPUT: no such world'; END IF; END $world$;`;

/** Call only on the fresh creation path, with maintenance credentials. Never on up or restore. */
export async function migrateCatalogue(admin: Admin): Promise<void> {
  await admin(await readFile(new URL("./catalogue.sql", import.meta.url), "utf8"));
}

/** The caller supplies a restricted worker connection retargeted to this world's database. */
export function worldCatalogue(query: Admin, secrets: readonly string[]) {
  const sensitive = [...new Set(secrets.filter(Boolean).flatMap((secret) => /^0x[0-9a-f]{64}$/i.test(secret) ? [secret, secret.slice(2)] : [secret]))].sort((a, b) => b.length - a.length);
  const mask = (value: unknown): unknown => {
    if (typeof value === "string") {
      // Recorder fields can themselves carry JSON text. Mask its string values, not its serialized syntax.
      let nested: unknown;
      if (/^\s*[\[{]/.test(value)) {
        try { nested = JSON.parse(value); } catch { /* Ordinary non-JSON text. */ }
        if (nested !== undefined) return JSON.stringify(mask(nested));
      }
      let text = redactSecrets(value);
      for (const secret of sensitive) text = text.replaceAll(secret, "[REDACTED]");
      return text;
    }
    if (Array.isArray(value)) return value.map(mask);
    if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) =>
      [key, isCredentialField(key) ? "[REDACTED]" : mask(entry)]));
    // A credential's digit sequence can equal a legitimate duration/sequence. Preserve scalar types.
    return value;
  };
  const clean = (value: unknown): string | null => {
    if (value === undefined) return null;
    // Normalize JSON values before traversing; prose sanitizers never touch the serialized envelope.
    return JSON.stringify(mask(JSON.parse(JSON.stringify(value))));
  };
  const appendSql = (world: string, command: Command, event?: { from: string; to: string; transition: string }) => {
    let result = clean(command.result);
    if (result && Buffer.byteLength(result) > 30000) result = JSON.stringify({ truncated: true, bytes: Buffer.byteLength(result), head: result.slice(0, 2000) });
    const data = {
      world_id: world, v: 1, id: randomUUID(), trace_id: command.trace, kind: command.kind ?? "command", command: command.command,
      args: clean(command.args ?? {}), actor_email: command.actor?.email ?? null, actor_address: command.actor?.address ?? null,
      actor_hats: command.actor?.hats ?? [], who_kind: command.actor?.kind ?? "system", org_id: command.org ?? null, site: command.site ?? null,
      world_time: new Date(command.worldTime).toISOString(), world_time_end: new Date(command.worldTimeEnd ?? command.worldTime).toISOString(),
      real_time: new Date(command.realTime ?? Date.now()).toISOString(), duration_ms: command.durationMs ?? 0, outcome: command.outcome,
      error_code: command.error?.code ?? null, error_reason: command.error ? JSON.parse(clean(command.error.reason)!) : null, error_detail: clean(command.error?.detail),
      result, changes: clean(command.changes ?? {}), run_id: command.run ?? null, model: command.model ?? null,
      policy_version: command.policyVersion ?? null, surface: command.surface ?? null, cause_seq: command.causeSeq ?? null, branch_abandoned: false,
    };
    return `INSERT INTO app.command_records SELECT ${[
        "r.world_id", "w.epoch", "coalesce((SELECT max(seq) FROM app.command_records WHERE world_id=w.world_id AND epoch=w.epoch),0)+1",
        `coalesce((SELECT ${hash("p")} FROM app.command_records p WHERE p.world_id=w.world_id AND p.epoch=w.epoch ORDER BY seq DESC LIMIT 1),repeat('0',64))`,
        ...Object.keys(data).slice(1).map((key) => key === "changes" && event ? `(r.changes::jsonb || jsonb_build_object('events',jsonb_build_array(jsonb_build_object(
          'event','world_transitioned','trace_id',r.trace_id,'from',${event.from},'to',${text(event.to)},'transition',${text(event.transition)},'world_id',w.world_id,'kind',w.kind,'epoch',w.epoch))))::text` : `r.${key}`),
      ].join(",")} FROM app.worlds w
      CROSS JOIN LATERAL ${rows("command_records", JSON.parse(clean(data)!))} r WHERE w.world_id=${text(world)}`;
  };
  const atomic = async (world: string, change: string, command: Command, event?: { from: string; to: string; transition: string }, after = "") => {
    assertWorld(world);
    const result = await query(`BEGIN; ${lock(world)} ${change} ${requireWorld(world)}
      ${appendSql(world, command, event)} RETURNING to_jsonb(command_records); ${after} COMMIT;`);
    if (result.length !== 1) throw new Error("catalogue mutation did not append exactly one command");
    return result[0]!;
  };
  const where = (world: string, filter: RecordFilter) => {
    assertWorld(world);
    const clauses = [`world_id=${text(world)}`];
    if (!filter.includeAbandoned) clauses.push("NOT branch_abandoned");
    if (filter.epoch !== undefined) {
      if (!Number.isSafeInteger(filter.epoch) || filter.epoch < 1) throw new Error("INVALID_INPUT: invalid epoch");
      clauses.push(`epoch=${filter.epoch}`);
    }
    if (filter.who !== undefined) clauses.push(`actor_email=${text(filter.who)}`);
    if (filter.kind !== undefined) clauses.push(`kind=${text(filter.kind)}`);
    if (filter.trace !== undefined) clauses.push(`trace_id=${text(filter.trace)}`);
    for (const [key, value, op] of [["from", filter.from, ">="], ["to", filter.to, "<="]] as const) if (value !== undefined) {
      if (!Number.isSafeInteger(value)) throw new Error(`INVALID_INPUT: invalid ${key}`);
      clauses.push(`world_time${op}${text(new Date(value).toISOString())}`);
    }
    return clauses.join(" AND ");
  };
  const records = async (world: string, filter: RecordFilter = {}) => {
    const limit = filter.limit ?? 1000;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000) throw new Error("INVALID_INPUT: invalid record limit");
    return query(`SELECT to_jsonb(r) FROM app.command_records r WHERE ${where(world, filter)} ORDER BY epoch,seq LIMIT ${limit}`);
  };
  const show = async (world: string): Promise<WorldRow> => {
    assertWorld(world);
    const [row] = await query(`SELECT to_jsonb(w) FROM app.worlds w WHERE world_id=${text(world)}`);
    if (!row) throw new Error("INVALID_INPUT: no such world");
    return row as WorldRow;
  };
  const cutSql = (alias: string) => `jsonb_build_object('epoch',${alias}.epoch,'seq',coalesce(r.seq,0),'head',CASE WHEN r.seq IS NULL THEN repeat('0',64) ELSE ${hash("r")} END)`;
  const headSql = `LEFT JOIN LATERAL (SELECT * FROM app.command_records WHERE world_id=w.world_id AND epoch=w.epoch ORDER BY seq DESC LIMIT 1) r ON true`;
  const cut = async (world: string): Promise<CatalogueCut> => {
    assertWorld(world);
    const [row] = await query(`SELECT ${cutSql("w")} FROM app.worlds w ${headSql} WHERE w.world_id=${text(world)}`);
    if (!row) throw new Error("INVALID_INPUT: no such world");
    return row as CatalogueCut;
  };
  /** The world row and its current-epoch head in one statement, so a concurrent restore cannot split them. */
  const view = async (world: string): Promise<{ world: WorldRow; cut: CatalogueCut }> => {
    assertWorld(world);
    const [row] = await query(`SELECT jsonb_build_object('world',to_jsonb(w),'cut',${cutSql("w")}) FROM app.worlds w ${headSql} WHERE w.world_id=${text(world)}`);
    if (!row) throw new Error("INVALID_INPUT: no such world");
    return row as { world: WorldRow; cut: CatalogueCut };
  };
  const history = async (world: string, filter: Pick<RecordFilter, "from" | "to"> = {}): Promise<CatalogueHistory> => {
    const [row] = await query(`SELECT jsonb_build_object('lineage',jsonb_build_object('parentWorld',w.parent_world,'parentSnapshot',w.parent_snapshot,'parentSeq',w.parent_seq),
      'cut',${cutSql("w")},'records',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY epoch,seq) FROM app.command_records e WHERE ${where(world, { ...filter, includeAbandoned: true })}),'[]'::jsonb),
      'snapshots',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY created_at,name) FROM app.world_snapshots s WHERE world_id=w.world_id),'[]'::jsonb))
      FROM app.worlds w ${headSql} WHERE w.world_id=${text(world)}`);
    if (!row) throw new Error("INVALID_INPUT: no such world");
    return row as CatalogueHistory;
  };
  return {
    async create(world: WorldRow, command: Command) {
      if (world.state !== "creating" || world.epoch !== 1) throw new Error("INVALID_INPUT: new world must begin creating at epoch 1");
      return atomic(world.world_id, `INSERT INTO app.worlds SELECT * FROM ${rows("worlds", world)};`, { ...command, kind: "born" }, { from: "NULL", to: "creating", transition: "create" });
    },
    show,
    view,
    cut,
    history,
    append: (world: string, command: Command) => atomic(world, "", command),
    async transition(world: string, transition: "start" | "stop" | "resume" | "restore" | "restored" | "park" | "close", command: Command) {
      const [from, to] = {
        start: [["creating"], "running"], stop: [["running"], "stopped"], resume: [["stopped", "parked"], "running"],
        restore: [["running"], "restoring"], restored: [["restoring"], "running"], park: [["running"], "parked"], close: [["stopped", "parked"], "closed"],
      }[transition] as [string[], string];
      const guard = `DO $state$ BEGIN IF NOT EXISTS (SELECT FROM app.worlds WHERE world_id=${text(world)} AND state IN (${from.map(text).join(",")})) THEN RAISE EXCEPTION 'WRONG_STATE: invalid world transition'; END IF; END $state$;`;
      return atomic(world, `${requireWorld(world)} ${guard}`, command, { from: "w.state", to, transition },
        `UPDATE app.worlds SET state=${text(to)},updated_at=${Date.now()} WHERE world_id=${text(world)};`);
    },
    /** A warp moved the frozen world's clock: the row's now follows it, with the command that moved it. */
    async clock(world: string, nowMs: number, command: Command) {
      if (!Number.isSafeInteger(nowMs)) throw new Error("INVALID_INPUT: invalid world now");
      return atomic(world, "", command, undefined, `UPDATE app.worlds SET world_now=${nowMs},updated_at=${nowMs} WHERE world_id=${text(world)};`);
    },
    async save(snapshot: SnapshotRow, command: Command) {
      return atomic(snapshot.world_id, `INSERT INTO app.world_snapshots SELECT * FROM ${rows("world_snapshots", snapshot)};`, command);
    },
    /** Called offline on the restored database, never on its immutable snapshot template. */
    async rewrite(world: WorldRow, saved: RestoreCatalogue, command: Command) {
      assertWorld(saved.sourceWorld);
      if (!Number.isSafeInteger(saved.cut.epoch) || saved.cut.epoch < 1 || !Number.isSafeInteger(saved.cut.seq) || saved.cut.seq < 1 || !/^[0-9a-f]{64}$/.test(saved.cut.head))
        throw new Error("INVALID_INPUT: invalid catalogue cut");
      const source = await show(saved.sourceWorld);
      const actual = await cut(saved.sourceWorld);
      if (actual.epoch !== saved.cut.epoch || actual.seq !== saved.cut.seq || actual.head !== saved.cut.head) throw new Error("WRONG_STATE: catalogue cut differs from saved world");
      const restoreCommand: Command = { ...command, changes: { ...command.changes, lineage: { snapshot: saved.snapshot, fromWorld: saved.sourceWorld,
        epoch: actual.epoch, seq: actual.seq, head: `0x${actual.head}` } } };
      if (world.world_id !== saved.sourceWorld) {
        if (world.epoch !== 1 || world.parent_world !== saved.sourceWorld || world.parent_snapshot !== saved.snapshot || world.parent_seq !== saved.cut.seq)
          throw new Error("INVALID_INPUT: clone must name its exact parent cut");
        return atomic(world.world_id, `INSERT INTO app.worlds SELECT * FROM ${rows("worlds", { ...world, state: "creating" })};`, { ...restoreCommand, kind: "born" }, { from: "NULL", to: "creating", transition: "create" });
      }
      if (world.epoch <= source.epoch || !saved.abandoned) throw new Error("INVALID_INPUT: in-place restore requires a new epoch and its abandoned branch");
      if (source.state !== "running") throw new Error("WRONG_STATE: saved world was not running");
      const branch = saved.abandoned.records;
      if (world.epoch !== saved.abandoned.cut.epoch + 1 || branch.some((r) => r.world_id !== world.world_id || !Number.isSafeInteger(r.epoch) || !Number.isSafeInteger(r.seq) || Number(r.epoch) >= world.epoch))
        throw new Error("INVALID_INPUT: abandoned records belong to another world or have an invalid position");
      if (saved.abandoned.snapshots.some((s) => s.world_id !== world.world_id)) throw new Error("INVALID_INPUT: snapshots belong to another world");
      const incoming = `jsonb_populate_recordset(NULL::app.command_records,${json(branch)})`;
      const incomingSnapshots = `jsonb_populate_recordset(NULL::app.world_snapshots,${json(saved.abandoned.snapshots)})`;
      // Quote the entire PL/pgSQL body: retained user text may contain any dollar-quote delimiter.
      const compatible = `DO ${text(`BEGIN IF EXISTS (SELECT FROM ${incoming} r JOIN app.command_records p USING(world_id,epoch,seq)
        WHERE (to_jsonb(r)-'branch_abandoned')<>(to_jsonb(p)-'branch_abandoned')) THEN RAISE EXCEPTION 'WRONG_STATE: abandoned prefix differs'; END IF; END`)};`;
      const retain = `INSERT INTO app.command_records SELECT * FROM ${incoming} ON CONFLICT (world_id,epoch,seq) DO NOTHING;
        DO ${text(`BEGIN IF EXISTS (SELECT FROM (SELECT seq,prev,row_number() OVER (PARTITION BY epoch ORDER BY seq) AS expected_seq,
          lag(${hash("p")}) OVER (PARTITION BY epoch ORDER BY seq) AS expected_prev FROM app.command_records p WHERE world_id=${text(world.world_id)}) h
          WHERE seq<>expected_seq OR prev<>coalesce(expected_prev,repeat('0',64))) THEN RAISE EXCEPTION 'WRONG_STATE: abandoned record chain is invalid'; END IF;
          IF NOT EXISTS (SELECT FROM app.command_records r WHERE world_id=${text(world.world_id)} AND epoch=${saved.abandoned.cut.epoch} AND seq=${saved.abandoned.cut.seq} AND ${hash("r")}=${text(saved.abandoned.cut.head)})
          OR (SELECT max(seq) FROM app.command_records WHERE world_id=${text(world.world_id)} AND epoch=${saved.abandoned.cut.epoch})<>${saved.abandoned.cut.seq}
          THEN RAISE EXCEPTION 'WRONG_STATE: abandoned branch head differs'; END IF;
          IF EXISTS (SELECT FROM ${incomingSnapshots} s JOIN app.world_snapshots p USING(world_id,name) WHERE to_jsonb(s)<>to_jsonb(p))
          THEN RAISE EXCEPTION 'WRONG_STATE: retained snapshot metadata differs'; END IF; END`)};
        UPDATE app.command_records SET branch_abandoned=true WHERE world_id=${text(world.world_id)} AND (epoch>${saved.cut.epoch} OR (epoch=${saved.cut.epoch} AND seq>${saved.cut.seq}));
        INSERT INTO app.world_snapshots SELECT * FROM ${incomingSnapshots} ON CONFLICT (world_id,name) DO NOTHING;`;
      const assignments = ["name", "kind", "profile", "address", "template", "chain_id", "chain_instance", "clock_mode", "rate", "world_now", "epoch", "parent_world", "parent_snapshot", "parent_seq", "hosted", "state", "created_at", "updated_at"].map((key) => `${key}=r.${key}`).join(",");
      return atomic(world.world_id, `${compatible} ${retain} UPDATE app.worlds w SET ${assignments} FROM ${rows("worlds", { ...world, state: "restoring" })} r WHERE w.world_id=r.world_id;`,
        { ...restoreCommand, kind: "restore" }, { from: text(source.state), to: "restoring", transition: "restore" });
    },
    async snapshots(world: string) {
      await show(world);
      return query(`SELECT to_jsonb(s) FROM app.world_snapshots s WHERE world_id=${text(world)} ORDER BY created_at DESC,name`);
    },
    records,
    async record(world: string, epoch: number, seq: number) {
      if (!Number.isSafeInteger(seq) || seq < 1) throw new Error("INVALID_INPUT: invalid sequence");
      const [row] = await query(`SELECT to_jsonb(r) FROM app.command_records r WHERE ${where(world, { epoch, includeAbandoned: true })} AND seq=${seq}`);
      if (!row) throw new Error("INVALID_INPUT: no such record");
      return row;
    },
    async export(world: string, filter: Pick<RecordFilter, "from" | "to"> = {}) {
      // One SQL statement fixes lineage and every row to the same MVCC snapshot; no pagination limit.
      const row = await history(world, filter);
      const lines = [JSON.stringify(row.lineage), ...row.records.map((entry) => JSON.stringify(entry))];
      const data = lines.join("\n") + "\n";
      return { data, lines: lines.length, bytes: Buffer.byteLength(data), lineage: row.lineage };
    },
  };
}
export type WorldCatalogue = ReturnType<typeof worldCatalogue>;
