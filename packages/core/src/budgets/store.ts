// What Core keeps of a budget's creation (migrations/0007_budgets_creations.sql): its name, its holder and what it
// proposed, and, once it landed, the budget the chain made. Every figure of a budget is the chain's (./chain.ts).
// Every write is made inside the caller's transaction.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as PgClient from "@effect/sql-pg/PgClient";

/** A budget's creation, as proposed to the Directors. Ids and amounts are decimal text. */
export interface Creation {
  readonly creation: string;
  readonly org: string;
  readonly parent: string;
  readonly parent_hat: string;
  readonly name: string;
  readonly holder: string;
  /** Per period, in the smallest unit of the parent's token. */
  readonly amount: string;
  /** The hat its transaction makes. */
  readonly hat: string;
  readonly proposal: string;
  readonly nonce: number;
  readonly proposed_ms: number;
}

export const insertCreation = Effect.fn("budgets.creation")(function* (creation: Creation) {
  const sql = yield* PgClient.PgClient;
  yield* sql`insert into app.budget_creations ${sql.insert({ ...creation, state: "proposed", budget: null })}`;
});

export const creationOf = Effect.fn("budgets.creationOf")(function* (creation: string) {
  const sql = yield* PgClient.PgClient;
  return Arr.head(
    yield* sql<
      Creation & { readonly state: string; readonly budget: string | null }
    >`select * from app.budget_creations where creation = ${creation}`,
  );
});

/** How many creations of the company still wait for its Directors whose new hat goes under `parentHat`. */
export const waitingUnder = Effect.fn("budgets.waiting")(function* (org: string, parentHat: string) {
  const sql = yield* PgClient.PgClient;
  const [row] = yield* sql<{ readonly n: number }>`
    select count(*)::integer as n from app.budget_creations
    where org = ${org} and parent_hat = ${parentHat} and state = 'proposed'`;
  return row?.n ?? 0;
});

/** A creation landed: the chain made budget `budget`, or no budget Core could find among its logs. */
export const markCreated = Effect.fn("budgets.created")(function* (creation: string, budget: string | null) {
  const sql = yield* PgClient.PgClient;
  yield* sql`update app.budget_creations set state = 'created', budget = ${budget} where creation = ${creation}`;
});

/** The name a budget of the company was proposed with, if Core proposed it. */
export const nameOf = Effect.fn("budgets.name")(function* (org: string, budget: string) {
  const sql = yield* PgClient.PgClient;
  const rows = yield* sql<{ readonly name: string }>`
    select name from app.budget_creations where org = ${org} and budget = ${budget}`;
  return Option.map(Arr.head(rows), (row) => row.name);
});

/** What the company is called, which its top budget is called too. */
export const companyNameOf = Effect.fn("budgets.companyName")(function* (org: string) {
  const sql = yield* PgClient.PgClient;
  const rows = yield* sql<{ readonly name: string }>`select name from app.companies where org = ${org}`;
  return Option.map(Arr.head(rows), (row) => row.name);
});
