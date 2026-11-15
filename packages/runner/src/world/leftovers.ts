// What the accounts hold of one stage, read from Cloudflare's and Neon's own APIs by name: taken before a destroy,
// it proves the search finds the stage's resources; taken after, it shows nothing is left (roadmap, world lifecycle
// rule 4). Only names are kept, never an id that grants access.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

export const Inventory = Schema.Struct({
  /** Cloudflare Worker scripts whose name holds the stage's name. */
  workers: Schema.Array(Schema.String),
  /** Cloudflare Hyperdrive configurations whose name holds the stage's name. */
  hyperdrives: Schema.Array(Schema.String),
  /** Neon projects whose name holds the stage's name. */
  neonProjects: Schema.Array(Schema.String),
  /**
   * For a run in private worlds: every resource of the worlds it made, in either account, by name (packages/world's
   * inventory): Workers, container applications, Durable Object namespaces, R2 buckets, Hyperdrive configurations
   * and Neon branches, snapshots' included.
   */
  worlds: Schema.String.pipe(Schema.Array, Schema.optional),
});
export type Inventory = typeof Inventory.Type;

export interface Accounts {
  readonly cloudflareAccount: string;
  readonly neonOrg: string;
}

const Named = Schema.Array(Schema.Struct({ id: Schema.optional(Schema.String), name: Schema.optional(Schema.String) }));
const CloudflareList = Schema.Struct({ result: Named });
const NeonList = Schema.Struct({ projects: Named });

const getJson = <A>(url: string, schema: Schema.Codec<A, unknown>) =>
  HttpClient.execute(HttpClientRequest.get(url)).pipe(
    Effect.flatMap((response) => response.json),
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
  );

const holding = (stage: string, items: typeof Named.Type): Array<string> =>
  Arr.filter(
    Arr.map(items, (item) => item.name ?? item.id ?? ""),
    (name) => Str.includes(stage)(Str.toLowerCase(name)),
  );

const CLOUDFLARE = "https://api.cloudflare.com/client/v4";

/** Everything named after `stage` in the two accounts. */
export const inventory = Effect.fn("world.inventory")(function* (stage: string, accounts: Accounts) {
  const account = `${CLOUDFLARE}/accounts/${accounts.cloudflareAccount}`;
  const [workers, hyperdrives, projects] = yield* Effect.all(
    [
      getJson(`${account}/workers/scripts`, CloudflareList),
      getJson(`${account}/hyperdrive/configs`, CloudflareList),
      getJson(`https://console.neon.tech/api/v2/projects?limit=400&org_id=${accounts.neonOrg}`, NeonList),
    ],
    { concurrency: 3 },
  );
  return {
    workers: holding(stage, workers.result),
    hyperdrives: holding(stage, hyperdrives.result),
    neonProjects: holding(stage, projects.projects),
  } satisfies Inventory;
});

/** True when nothing of the stage is left. */
export const isEmpty = (found: Inventory): boolean =>
  found.workers.length === 0 &&
  found.hyperdrives.length === 0 &&
  found.neonProjects.length === 0 &&
  (found.worlds ?? []).length === 0;

/**
 * What `found` holds but the worlds handed over to CI's teardown job (RUNNER_TEARDOWN=job): a name carries a world's
 * stage as packages/world's `namesOfWorlds` reads it. Only what is left beyond those fails a run.
 */
export const butHandedOver = (found: Inventory, handedOver: ReadonlyArray<string> = []): Inventory => ({
  ...found,
  worlds: Arr.filter(
    found.worlds ?? [],
    (name) => !Arr.some(handedOver, (stage) => Str.includes(`-${stage}-`)(name) || Str.endsWith(`/${stage}`)(name)),
  ),
});
