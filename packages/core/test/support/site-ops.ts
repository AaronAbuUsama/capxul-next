// The harness of the five operations' tests (site-ops-*.test.ts): Core's groups served in memory with sign-in and
// telemetry, against a stand-in of the Capxul app's `capxul.core_api` on company sites, every question to a site kept.
import { strict as assert } from "node:assert";
import { CREDENTIAL_HEADER, type Errors, PERSON_HEADER, Record as RecordOps, TRACE_HEADER } from "@capxul/blueprint";
import * as Schema from "effect/Schema";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Str from "effect/String";
import * as RpcTest from "effect/rpc/RpcTest";
import type * as Scope from "effect/Scope";
import { CoreIdentity, CoreRpcs, Served, SpanSink } from "../../src/door.ts";
import { millisOf, siteOpsInMemory, type InMemory, type TestSite } from "../../src/site-ops/door.ts";

type Refusal = InstanceType<(typeof Errors.refusals)[Errors.RefusalTag]>;

export const ORG = "org_northwind1";
export const START = millisOf("2026-11-13T09:00:00.000Z");
export const HASH = `0x${Str.repeat(32)("cd")}`;
export const CAST = { sam: "sam@cast.test", dana: "dana@cast.test", pat: "pat@cast.test" };
export const trace = (n: number) => Str.padStart(32, "0")(n.toString(16));

export type Asked = { readonly site: string; readonly method: string; readonly body: Record<string, unknown> };

/** A company site: `org`'s, answering each method as `answers` says, every question kept in `asked`. */
export const site = (
  name: string,
  org: string,
  asked: Array<Asked>,
  answers: Record<string, (body: Record<string, unknown>) => unknown>,
  state: TestSite["state"] = "ready",
): TestSite => ({
  site: name,
  state,
  answer: (method, body) =>
    Effect.sync(() => {
      const given: Record<string, unknown> = Predicate.isObject(body) ? { ...body } : {};
      asked.push({ site: name, method, body: given });
      if (method !== "warp" && given["org"] !== org) return { refused: "org-not-here", org: given["org"] };
      return answers[method]?.(given) ?? { refused: "site-refused", target: "", reason: "not_found", message: method };
    }),
});

/** Serves Core's groups over `world`, and calls one operation at a time as `who`, each in a trace of its own. */
export const world = (options: InMemory) =>
  Effect.gen(function* () {
    const ops = siteOpsInMemory({ clock: { mode: "frozen", frozenAtMs: START, offsetMs: 0 }, cast: CAST, ...options });
    const identity = Layer.succeed(CoreIdentity, {
      world: "town",
      owner: "ci",
      doorToken: Redacted.make("door"),
      platformToken: Redacted.make("platform"),
    });
    const sink = Layer.succeed(SpanSink, SpanSink.of({ keep: () => Effect.void }));
    const context = yield* Layer.build(
      Served.pipe(Layer.provideMerge(ops), Layer.provide(Layer.merge(identity, sink))),
    );
    const client = yield* RpcTest.makeClient(CoreRpcs, { flatten: true }).pipe(Effect.provideContext(context));
    let n = 0;
    const call = (tag: string, payload: unknown, as?: string) => {
      n += 1;
      const headers = {
        [CREDENTIAL_HEADER]: "Bearer door",
        [TRACE_HEADER]: `00-${trace(n)}-${Str.repeat(16)("1")}-01`,
        ...(as === undefined ? {} : { [PERSON_HEADER]: as }),
      };
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- each operation is called by name with its own payload, which the flat client's per-name types cannot follow
      const send = client as unknown as (tag: string, payload: unknown, options: object) => Effect.Effect<any, Refusal>;
      return Effect.exit(send(tag, payload, { headers }));
    };
    const record = (from: number | null = null, to: number | null = null) =>
      Effect.flatMap(call("record.export", { from, to }), (exit) =>
        Exit.isSuccess(exit)
          ? Schema.decodeUnknownEffect(RecordOps.exportRecord.rpc.successSchema)(exit.value).pipe(Effect.orDie)
          : Effect.die(exit.cause.pipe(Cause.pretty)),
      );
    return { call, record };
  });

export const run = <A>(effect: Effect.Effect<A, never, Scope.Scope>) => Effect.runPromise(effect.pipe(Effect.scoped));
export const refusal = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? exit.cause.pipe(Cause.findErrorOption, Option.getOrUndefined) : undefined;
/** A refusal's fields, its tag among them. */
export const fields = (exit: Exit.Exit<unknown, unknown>): Readonly<Record<string, unknown>> => {
  const error = refusal(exit);
  return Predicate.isObject(error) ? { ...error } : {};
};
export const value = (exit: Exit.Exit<any, unknown>) => {
  assert.ok(Exit.isSuccess(exit), Exit.isFailure(exit) ? exit.cause.pipe(Cause.pretty) : "");
  return exit.value;
};

export const created = (body: Record<string, unknown>) => ({
  doctype: body["doctype"],
  name: "Brightside Cleaning Ltd",
  docstatus: 0,
  fields: body["fields"],
  hash: HASH,
});
