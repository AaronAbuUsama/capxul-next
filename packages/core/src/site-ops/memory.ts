// What the five operations run on in a test: everything in memory, with a site door that answers as the test says.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Str from "effect/String";
import { SiteDoorFailed } from "../failures.ts";
import { SiteDoor, type SiteAnswer, type SiteCall } from "../site/SiteDoor.ts";
import { memoryCast } from "./cast.ts";
import { memoryWorldClock, type StoredClock } from "./clock.ts";
import { memoryDocumentHashes } from "./hashes.ts";
import { PaymentApprovals, PaymentApprovalsUnbuilt } from "./payments.ts";
import { memoryWorldRecord, type KeptEntry } from "./record.ts";
import { CompanySitesLive } from "./sites.ts";
import { ChainTime } from "./chain-time.ts";

/** A site in a test: its name, its state, and what its `capxul.core_api` methods answer. */
export interface TestSite {
  readonly site: string;
  readonly state: "creating" | "ready" | "failed";
  readonly answer: (method: string, body: unknown) => Effect.Effect<unknown>;
}

/** A site door over `sites`: each call to a method answers HTTP 200 with the site's `message`. */
export const testSiteDoor = (sites: ReadonlyArray<TestSite>) =>
  Layer.succeed(
    SiteDoor,
    SiteDoor.of({
      sites: Effect.succeed({ world: "town", sites: Arr.map(sites, ({ site, state }) => ({ site, state })) }),
      clock: () => Effect.succeed({ status: 200, body: {} }),
      make: (label) => Effect.succeed({ site: `${label}-town.test`, state: "creating" }),
      site: (site) =>
        Effect.succeed(
          Option.match(
            Arr.findFirst(sites, (each) => each.site === site),
            { onNone: () => ({ site, state: "failed" }), onSome: (found) => ({ site, state: found.state }) },
          ),
        ),
      remove: () => Effect.void,
      call: (site: string, call: SiteCall) => {
        const method = Str.replace("/api/method/capxul.core_api.", "")(call.path);
        return Option.match(
          Arr.findFirst(sites, (each) => each.site === site),
          {
            onNone: () =>
              Effect.fail(
                SiteDoorFailed.make({ reason: "refused", status: 403, code: "site-not-in-world", message: site }),
              ),
            onSome: (found) =>
              Effect.map(found.answer(method, call.body), (message): SiteAnswer => ({
                status: 200,
                body: { message },
              })),
          },
        );
      },
    }),
  );

/** The first entry of a world made from nothing, as world.create keeps it. */
export const madeFromNothing = (world: string, owner: string, atMs: number): Omit<KeptEntry, "seq"> => ({
  event: "world_created",
  atMs,
  trace: Str.repeat(32)("0"),
  carried: { world, owner, grade: "private", expiresAt: "2026-11-13T11:00:00.000Z", parent: null },
});

export interface InMemory {
  readonly sites?: ReadonlyArray<TestSite>;
  readonly clock?: StoredClock;
  readonly record?: ReadonlyArray<Omit<KeptEntry, "seq">>;
  readonly cast?: Readonly<Record<string, string>>;
  readonly approvals?: Layer.Layer<PaymentApprovals>;
  readonly chain?: Layer.Layer<ChainTime>;
}

/** Every service the five operations need, in memory. */
export const siteOpsInMemory = (options: InMemory = {}) =>
  memoryCast(options.cast ?? {}).pipe(
    Layer.merge(memoryDocumentHashes),
    Layer.merge(CompanySitesLive.pipe(Layer.provide(testSiteDoor(options.sites ?? [])))),
    Layer.merge(options.chain ?? Layer.succeed(ChainTime, ChainTime.of({ mineAt: () => Effect.succeed(false) }))),
    Layer.merge(options.approvals ?? PaymentApprovalsUnbuilt),
    Layer.provideMerge(memoryWorldRecord(options.record ?? [])),
    Layer.provideMerge(memoryWorldClock(options.clock)),
  );
