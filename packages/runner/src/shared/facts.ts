// What a shared world keeps of how its starting worlds were made: each one's facts
// (packages/blueprint/docs/decisions.md, entry 38), as its maker answered them, in a table of the world's own database,
// written just before the snapshot of that starting world is saved. So each snapshot carries its own facts and those of
// the worlds before it, and a world restored from the snapshot holds them too: a run on the shared world, which never
// made those worlds, hands a journey the facts of the world it was restored from. The facts are the maker's encoded
// values, kept as jsonb.
import * as World from "@capxul/world";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { RunnerFailure } from "../failure.ts";
import type { Facts } from "../worlds/makers.ts";

/** A world's name and a way to send it SQL: `World.World`'s, or a stand-in's (test/kept-facts.test.ts). */
export interface Held<E extends { readonly _tag: string }, R> {
  readonly name: string;
  readonly sql: (statement: string, params?: ReadonlyArray<unknown>) => Effect.Effect<unknown, E, R>;
}

const TABLE = "runner.starting_worlds";

const Rows = Schema.Array(Schema.Struct({ facts: Schema.Record(Schema.String, Schema.Unknown) }));
const Names = Schema.Array(Schema.Struct({ name: Schema.String }));
const Kept = Schema.Array(Schema.Struct({ kept: Schema.Boolean }));

const failed = (world: { readonly name: string }, message: string) =>
  RunnerFailure.make({ step: "starting world", message: `${world.name}: ${message}` });

/** Keeps `facts` as the facts of the starting world `name` in `world`, replacing any kept before. */
export const keepFacts = <E extends { readonly _tag: string }, R>(world: Held<E, R>, name: string, facts: Facts) =>
  Effect.gen(function* () {
    yield* world.sql("create schema if not exists runner");
    yield* world.sql(
      `create table if not exists ${TABLE} (name text primary key, facts jsonb not null, kept_at timestamptz not null default now())`,
    );
    yield* world.sql(
      `insert into ${TABLE} (name, facts) values ($1, $2) on conflict (name) do update set facts = excluded.facts, kept_at = now()`,
      [name, facts],
    );
  }).pipe(Effect.mapError((error) => failed(world, `the facts of ${name} were not kept: ${error._tag}`)));

/**
 * The moves of kept facts, in order, each idempotent, each with the parameters it is sent with.
 *
 * `budgets`: the blueprint's ChainContracts named the Budgets contract from 15 November 2026; facts kept before then
 * hold world.create, world.show and world.snapshot.restore answers (in `calls`, and as `world`) whose
 * contracts lack it. Every world's chain has held it since its seed, at `CONTRACTS.budgets`, as Core's
 * 0008_world_budgets.sql adds it to the world's own contracts.
 */
export const MOVES: ReadonlyArray<{
  readonly name: string;
  readonly query: string;
  readonly params: ReadonlyArray<unknown>;
}> = [
  {
    name: "budgets in the calls' answers",
    query: `update ${TABLE} set facts = jsonb_set(facts, '{calls}', (
      select coalesce(jsonb_agg(case
        when jsonb_typeof(c->'answer'->'contracts') = 'object' and c->'answer'->'contracts'->'budgets' is null
        then jsonb_set(c, '{answer,contracts,budgets}', to_jsonb($1::text)) else c end order by o), '[]'::jsonb)
      from jsonb_array_elements(facts->'calls') with ordinality as t(c, o)))
    where jsonb_typeof(facts->'calls') = 'array'`,
    params: [World.CONTRACTS.budgets],
  },
  {
    name: "budgets in the world",
    query: `update ${TABLE} set facts = jsonb_set(facts, '{world,contracts,budgets}', to_jsonb($1::text))
    where jsonb_typeof(facts->'world'->'contracts') = 'object' and facts->'world'->'contracts'->'budgets' is null`,
    params: [World.CONTRACTS.budgets],
  },
];

/** Moves the facts `world` keeps to the format the blueprint decodes now (`MOVES`); nothing when it keeps none. */
export const moveKept = <E extends { readonly _tag: string }, R>(world: Held<E, R>) =>
  Effect.gen(function* () {
    if (!(yield* keepsAny(world))) return;
    for (const move of MOVES) yield* world.sql(move.query, [...move.params]);
  }).pipe(Effect.mapError((error) => failed(world, `its kept facts were not moved: ${error._tag}`)));

/** Whether `world` keeps any facts at all: a world made otherwise has no such table. */
const keepsAny = <E extends { readonly _tag: string }, R>(world: Held<E, R>) =>
  Effect.map(world.sql("select to_regclass($1) is not null as kept", [TABLE]), (rows) =>
    Option.match(Schema.decodeUnknownOption(Kept)(rows), {
      onNone: () => false,
      onSome: (found) => Arr.some(found, (row) => row.kept),
    }),
  );

/** The facts `world` keeps of the starting world `name`; none when it keeps none. */
export const factsIn = <E extends { readonly _tag: string }, R>(world: Held<E, R>, name: string) =>
  Effect.gen(function* () {
    if (!(yield* keepsAny(world))) return Option.none<Facts>();
    yield* moveKept(world);
    const rows = yield* Effect.flatMap(
      world.sql(`select facts from ${TABLE} where name = $1`, [name]),
      Schema.decodeUnknownEffect(Rows),
    );
    return Option.map(Arr.head(rows), (row): Facts => row.facts);
  }).pipe(Effect.mapError((error) => failed(world, `the facts of ${name} were not read: ${error._tag}`)));

/** The starting worlds `world` keeps facts of, by name, oldest first. */
export const keptNames = <E extends { readonly _tag: string }, R>(world: Held<E, R>) =>
  Effect.gen(function* () {
    if (!(yield* keepsAny(world))) return [];
    const rows = yield* Effect.flatMap(
      world.sql(`select name from ${TABLE} order by kept_at`),
      Schema.decodeUnknownEffect(Names),
    );
    return Arr.map(rows, (row) => row.name);
  }).pipe(Effect.mapError((error) => failed(world, `its starting worlds were not read: ${error._tag}`)));
