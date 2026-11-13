// One file's world in test/chain: Core served in a runtime of its own over the stand-in (world.ts), the world's
// database migrated afresh and its cast made, and the calls the files share. Files run one after another on the one
// chain (`--test-concurrency=1`), so each founds its own company.
import { Values } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { test } from "node:test";
import {
  answer,
  asPerson,
  core,
  fakeSiteDoor,
  FOUNDING,
  type Founding,
  makeCast,
  migrate,
  sign,
  type Urls,
} from "./world.ts";

/** The migrations a world applies, Core's and the world's own tables, in order, as text. */
export interface World {
  readonly urls: Urls;
  readonly migrations: ReadonlyArray<string>;
}

type Services = Layer.Success<ReturnType<typeof core>>;

/** A runtime of Core's services, the site door it was given, and `it`, a test that runs in it. */
export const open = (world: World) =>
  Effect.map(fakeSiteDoor, (site) => {
    const runtime = ManagedRuntime.make(core(world.urls, site.layer));
    const it = <E>(name: string, body: Effect.Effect<void, E, Services>) =>
      test(name, () => runtime.runPromise(Effect.orDie(body)));
    const fresh = Effect.andThen(migrate(world.migrations), makeCast);
    return { runtime, site, it, fresh };
  });

export const found = (founding: Founding, as: string) =>
  asPerson(as, (client, options) => client("org.create", founding, options));

export const grant = (org: string, member: string, permission: typeof Values.Permission.Type, as = "dana") =>
  asPerson(as, (client, options) => client("org.member.grant", { org, member, permission, note: null }, options));

/** Northwind founded by dana and its setup signed by dana and eli: the starting world `founded`'s chain. */
export const foundNorthwind = Effect.gen(function* () {
  const founded = yield* answer(yield* found(FOUNDING, "dana"));
  if (founded._tag !== "Founded") return yield* Effect.die("northwind was founded already");
  for (const approval of founded.approvals) yield* answer(yield* sign(approval));
  return founded;
});
