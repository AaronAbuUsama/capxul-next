// What a hub runs right now, from Cloudflare's own listing of its container applications: how many instances of each
// are active (running, and billed) against those merely placed in advance. A hub with no world in use runs nothing;
// Cloudflare bills a container only while it is active.
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { HubMissing } from "../failures.ts";
import { describeFailure } from "../lifecycle/describe.ts";

// Other applications of the account may say less about themselves; only the hub's are read closely.
const Applications = Schema.Struct({
  result: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      max_instances: Schema.optional(Schema.Finite),
      health: Schema.optional(
        Schema.Struct({ instances: Schema.optional(Schema.Record(Schema.String, Schema.Finite)) }),
      ),
    }),
  ),
});

/** Each of the hub's container applications, with its instances by state. */
export const hubContainers = Effect.fn("world.hub.containers")(
  function* (stage: string) {
    const account = yield* Config.String("CLOUDFLARE_ACCOUNT_ID");
    const key = yield* Config.Redacted("CLOUDFLARE_API_TOKEN");
    const answer = yield* HttpClient.execute(
      HttpClientRequest.get(`https://api.cloudflare.com/client/v4/accounts/${account}/containers/applications`).pipe(
        HttpClientRequest.bearerToken(Redacted.value(key)),
      ),
    ).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Applications)), Effect.scoped);
    const mine = Arr.filter(
      answer.result,
      (application) =>
        Str.startsWith("capxulworldhub-")(application.name) && Str.includes(`-${stage}-`)(application.name),
    );
    return Arr.map(mine, (application) => {
      const instances = application.health?.instances ?? {};
      return {
        application: application.name,
        maxInstances: application.max_instances ?? null,
        active: instances["active"] ?? 0,
        healthy: instances["healthy"] ?? 0,
        starting: instances["starting"] ?? 0,
        failed: instances["failed"] ?? 0,
      };
    });
  },
  Effect.mapError((error) => HubMissing.make({ hub: "?", message: describeFailure(error) })),
);

/**
 * Waits, at most a minute, until the hub runs no container: Cloudflare's count of active instances lags a container's
 * end by some seconds. Gives back the last reading and how long it took to show none active.
 */
export const hubIdle = (stage: string) =>
  Effect.gen(function* () {
    const began = yield* Clock.currentTimeMillis;
    const containers = yield* hubContainers(stage).pipe(
      Effect.repeat({
        schedule: Schedule.spaced("3 seconds"),
        until: (all) => Arr.every(all, (application) => application.active === 0),
        times: 20,
      }),
    );
    return { containers, idleAfterMs: (yield* Clock.currentTimeMillis) - began };
  });
