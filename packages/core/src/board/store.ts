// What Core keeps of each change to a company's Board (migrations/0007_board.sql): proposed to its founder, then
// landed. Every write is made inside the caller's transaction. The Board itself is the company's row in
// `app.organizations`, which a landed change updates (organizations/store.ts, `setBoard`).
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as PgClient from "@effect/sql-pg/PgClient";

/** A Board's size: how many Directors it has and how many must sign. */
export interface Seats {
  readonly directors: number;
  readonly threshold: number;
}

/** A change to a company's Board, as Core keeps it. */
export interface BoardChange {
  readonly change: string;
  readonly org: string;
  readonly action: "add" | "threshold";
  /** The person it seats; null for a threshold. */
  readonly person: string | null;
  readonly before: Seats;
  readonly after: Seats;
  /** When its approval expires, in world time. */
  readonly expiresMs: number;
  readonly state: "proposed" | "landed";
}

interface Row {
  readonly change: string;
  readonly org: string;
  readonly action: string;
  readonly person: string | null;
  readonly before_directors: number;
  readonly before_threshold: number;
  readonly after_directors: number;
  readonly after_threshold: number;
  readonly expires_ms: number;
  readonly state: string;
}

const decode = (row: Row): BoardChange => ({
  change: row.change,
  org: row.org,
  action: row.action === "add" ? "add" : "threshold",
  person: row.person,
  before: { directors: row.before_directors, threshold: row.before_threshold },
  after: { directors: row.after_directors, threshold: row.after_threshold },
  expiresMs: row.expires_ms,
  state: row.state === "landed" ? "landed" : "proposed",
});

/** Keeps a proposed change. */
export const insert = Effect.fn("board.insert")(function* (change: Omit<BoardChange, "state">) {
  const sql = yield* PgClient.PgClient;
  yield* sql`insert into app.board_changes ${sql.insert({
    change: change.change,
    org: change.org,
    action: change.action,
    person: change.person,
    before_directors: change.before.directors,
    before_threshold: change.before.threshold,
    after_directors: change.after.directors,
    after_threshold: change.after.threshold,
    expires_ms: change.expiresMs,
    state: "proposed",
  })}`;
});

/** The change to the company's Board that waits for its founder's signature at `nowMs`, if any. */
export const waitingOf = Effect.fn("board.waiting")(function* (org: string, nowMs: number) {
  const sql = yield* PgClient.PgClient;
  const rows = yield* sql<{ readonly change: string }>`
    select change from app.board_changes where org = ${org} and state = 'proposed' and expires_ms > ${nowMs}
    order by expires_ms limit 1`;
  return Arr.head(Arr.map(rows, (row) => row.change));
});

/** A change by its id, if it exists. */
export const changeOf = Effect.fn("board.changeOf")(function* (change: string) {
  const sql = yield* PgClient.PgClient;
  const rows = yield* sql<Row>`select * from app.board_changes where change = ${change}`;
  return Arr.head(Arr.map(rows, decode));
});

export const markLanded = Effect.fn("board.landed")(function* (change: string) {
  const sql = yield* PgClient.PgClient;
  yield* sql`update app.board_changes set state = 'landed' where change = ${change}`;
});
