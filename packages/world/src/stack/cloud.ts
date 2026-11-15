// What the two accounts hold, read straight from Cloudflare's and Neon's own APIs, not from Alchemy's state: the
// listing that shows a destroy left nothing behind, and the image repositories that `alchemy destroy` does leave.
// Both accounts hold the owner's real projects, so everything here names only what starts with this stack's name.
import * as Arr from "effect/Array";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { AccountUnreadable } from "../common/failures.ts";
import { projectId as worldsProjectId } from "../parts/database/neon.ts";
import { IMAGE_PREFIX, STACK } from "./names.ts";
import { describeFailure } from "../common/describe.ts";

const settings = Config.all({
  account: Config.String("CLOUDFLARE_ACCOUNT_ID"),
  cloudflare: Config.Redacted("CLOUDFLARE_API_TOKEN"),
  neon: Config.Redacted("NEON_API_KEY"),
  org: Config.String("NEON_ORG_ID"),
});

const CLOUDFLARE = "https://api.cloudflare.com/client/v4";
const NEON = "https://console.neon.tech/api/v2";
const REGISTRY = "https://registry.cloudflare.com";
const MANIFESTS =
  "application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json";

const unreadable = (what: string, status: number) => (error: unknown) =>
  AccountUnreadable.make({ what, status, message: Str.slice(0, 200)(describeFailure(error)) });

/** Sends one request; a 2xx answer is decoded with `schema`, anything else is the account's refusal. */
const send = <S extends Schema.Constraint>(what: string, request: HttpClientRequest.HttpClientRequest, schema: S) =>
  HttpClient.execute(request).pipe(
    Effect.mapError(unreadable(what, 0)),
    Effect.flatMap((response) =>
      response.status < 300
        ? HttpClientResponse.schemaBodyJson(schema)(response).pipe(Effect.mapError(unreadable(what, response.status)))
        : Effect.flatMap(
            Effect.orElseSucceed(response.text, () => ""),
            (body) =>
              Effect.fail(AccountUnreadable.make({ what, status: response.status, message: Str.slice(0, 200)(body) })),
          ),
    ),
    Effect.scoped,
  );

const ofThisStack = (name: string): boolean => pipe(name, Str.toLowerCase, Str.startsWith(Str.toLowerCase(STACK)));
const count = (names: ReadonlyArray<string>) => ({
  inAccount: names.length,
  ofThisStack: Arr.filter(names, ofThisStack),
});

const Items = Schema.Struct({ result: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)) });
const Buckets = Schema.Struct({
  result: Schema.Struct({ buckets: Schema.Array(Schema.Struct({ name: Schema.String })) }),
});
const Project = Schema.Struct({ project: Schema.Struct({ id: Schema.String, name: Schema.String }) });
const Branches = Schema.Struct({ branches: Schema.Array(Schema.Struct({ name: Schema.String })) });
const Catalog = Schema.Struct({ repositories: Schema.String.pipe(Schema.Array, Schema.optional) });
const Tags = Schema.Struct({ tags: Schema.String.pipe(Schema.Array, Schema.NullOr, Schema.optional) });
const Credentials = Schema.Struct({
  result: Schema.Struct({ username: Schema.optional(Schema.String), password: Schema.String }),
});

/** The text of one field of each item of a Cloudflare listing. */
const field = (key: string) => (items: typeof Items.Type) =>
  Arr.map(items.result, (item) => {
    const value = item[key];
    return Predicate.isString(value) ? value : "";
  });

/**
 * Takes the expiry Neon itself enforces off a branch. Neon refuses to fork a branch that has one ("Branches with an
 * expiration date cannot have child branches"), so a world that another is made from stops being deleted by Neon
 * and is deleted by the sweeper alone, at the same recorded expiry.
 */
export const liftBranchExpiry = Effect.fn("world.account.liftBranchExpiry")(function* (
  projectId: string,
  branchId: string,
) {
  const { neon } = yield* settings;
  yield* send(
    "neon branch expiry",
    HttpClientRequest.patch(`${NEON}/projects/${projectId}/branches/${branchId}`).pipe(
      HttpClientRequest.bearerToken(Redacted.value(neon)),
      HttpClientRequest.bodyJsonUnsafe({ branch: { expires_at: null } }),
    ),
    Schema.Unknown,
  );
});

/** A short-lived way in to Cloudflare's image registry, as a Basic authorization. */
const registryAuth = Effect.gen(function* () {
  const { account, cloudflare } = yield* settings;
  const { result } = yield* send(
    "registry credentials",
    HttpClientRequest.post(
      `${CLOUDFLARE}/accounts/${account}/containers/registries/registry.cloudflare.com/credentials`,
    ).pipe(
      HttpClientRequest.bearerToken(Redacted.value(cloudflare)),
      HttpClientRequest.bodyJsonUnsafe({ expiration_minutes: 5, permissions: ["pull", "push"] }),
    ),
    Credentials,
  );
  return { username: result.username ?? "v1", password: Redacted.make(result.password) };
});
type RegistryAuth = Effect.Success<typeof registryAuth>;

const registryRequest = (auth: RegistryAuth, method: "GET" | "DELETE" | "PUT", path: string) =>
  HttpClientRequest.make(method)(`${REGISTRY}${path}`).pipe(
    HttpClientRequest.basicAuth(auth.username, Redacted.value(auth.password)),
    HttpClientRequest.setHeader("Accept", MANIFESTS),
  );

/** The names of this stack's image repositories in Cloudflare's registry, without the account id in front. */
export const imageRepositories = Effect.gen(function* () {
  const auth = yield* registryAuth;
  const catalog = yield* send("registry catalog", registryRequest(auth, "GET", "/v2/_catalog"), Catalog);
  const names = Arr.map(catalog.repositories ?? [], (name) =>
    Option.getOrElse(Arr.last(Str.split(name, "/")), () => name),
  );
  return { inAccount: names.length, ofThisStack: Arr.filter(names, Str.startsWith(IMAGE_PREFIX)) };
}).pipe(Effect.withSpan("world.account.images"));

/** How many times a repository's references are listed and deleted before it is given up on. */
const ROUNDS = 5;

/**
 * Empties the named repositories and asks the registry to collect what they held. Deleting a tag can leave the
 * manifests it pointed at, which the registry then lists by digest, so each repository is listed and emptied again
 * until it lists nothing. Whether a repository is really gone is for the caller to read back.
 */
export const removeImageRepositories = Effect.fn("world.account.removeImages")(function* (
  repositories: ReadonlyArray<string>,
) {
  if (Arr.isReadonlyArrayEmpty(repositories)) return;
  const { account } = yield* settings;
  const auth = yield* registryAuth;
  const tagsOf = (path: string) =>
    send("registry tags", registryRequest(auth, "GET", `${path}/tags/list`), Tags).pipe(
      Effect.map((listed) => listed.tags ?? []),
      // A repository that is gone lists nothing.
      Effect.orElseSucceed((): ReadonlyArray<string> => []),
    );
  const empty = (path: string, round: number): Effect.Effect<void, AccountUnreadable, HttpClient.HttpClient> =>
    Effect.gen(function* () {
      const tags = yield* tagsOf(path);
      if (Arr.isReadonlyArrayEmpty(tags) || round >= ROUNDS) return;
      yield* Effect.forEach(tags, (reference) =>
        send("registry delete", registryRequest(auth, "DELETE", `${path}/manifests/${reference}`), Schema.Unknown).pipe(
          Effect.ignore,
        ),
      );
      yield* empty(path, round + 1);
    });
  yield* Effect.forEach(repositories, (repository) => empty(`/v2/${account}/${repository}`, 0));
  yield* send("registry collect", registryRequest(auth, "PUT", "/v2/gc/layers"), Schema.Unknown).pipe(Effect.ignore);
});

/** Everything of the kinds a world creates, counted in the two accounts, with what belongs to this stack named. */
export const inventory = Effect.gen(function* () {
  const { account, cloudflare, neon } = yield* settings;
  const cf = (what: string, path: string, key: string) =>
    send(
      what,
      HttpClientRequest.get(`${CLOUDFLARE}/accounts/${account}${path}`).pipe(
        HttpClientRequest.bearerToken(Redacted.value(cloudflare)),
      ),
      Items,
    ).pipe(Effect.map(field(key)));
  const neonGet = <S extends Schema.Constraint>(what: string, path: string, schema: S) =>
    send(
      what,
      HttpClientRequest.get(`${NEON}${path}`).pipe(HttpClientRequest.bearerToken(Redacted.value(neon))),
      schema,
    );
  // Every world's branch is in the one worlds project the platform stage recorded (database/neon.ts, projectId), so
  // that project is read by its id, never by listing the organization: CI's key is scoped to that project and may not
  // list the others (bootstrap.run.ts). With no platform stage there is no project, and nothing of this stack in Neon.
  const recorded = yield* Effect.option(worldsProjectId);
  const projects = Option.isNone(recorded)
    ? []
    : [(yield* neonGet("neon project", `/projects/${recorded.value}`, Project)).project];
  const ours = Arr.filter(projects, (project) => ofThisStack(project.name));
  const branches = Arr.flatten(
    yield* Effect.forEach(ours, (project) =>
      neonGet("neon branches", `/projects/${project.id}/branches`, Branches).pipe(
        Effect.map((answer) => Arr.map(answer.branches, (branch) => `${project.name}/${branch.name}`)),
      ),
    ),
  );
  const buckets = yield* send(
    "r2 buckets",
    HttpClientRequest.get(`${CLOUDFLARE}/accounts/${account}/r2/buckets?per_page=1000`).pipe(
      HttpClientRequest.bearerToken(Redacted.value(cloudflare)),
    ),
    Buckets,
  );
  return {
    workers: count(yield* cf("workers", "/workers/scripts", "id")),
    containerApplications: count(yield* cf("container applications", "/containers/applications", "name")),
    durableObjectNamespaces: count(
      yield* cf("durable object namespaces", "/workers/durable_objects/namespaces?per_page=1000", "script"),
    ),
    r2Buckets: count(Arr.map(buckets.result.buckets, (bucket) => bucket.name)),
    hyperdriveConfigurations: count(yield* cf("hyperdrive configurations", "/hyperdrive/configs", "name")),
    neonProjects: count(Arr.map(projects, (project) => project.name)),
    neonBranches: { inThisStacksProjects: branches.length, names: branches },
    imageRepositories: yield* imageRepositories,
  };
}).pipe(Effect.withSpan("world.account.inventory"));
export type Inventory = Effect.Success<typeof inventory>;

/** What an inventory names of this stack, kind by kind: the part a destroy must leave as it was. */
export interface StackListing {
  readonly workers: ReadonlyArray<string>;
  readonly containerApplications: ReadonlyArray<string>;
  readonly durableObjectNamespaces: ReadonlyArray<string>;
  readonly r2Buckets: ReadonlyArray<string>;
  readonly hyperdriveConfigurations: ReadonlyArray<string>;
  readonly neonBranches: ReadonlyArray<string>;
  readonly imageRepositories: ReadonlyArray<string>;
}

export const ofThisStackOnly = (listing: Inventory): StackListing => ({
  workers: listing.workers.ofThisStack,
  containerApplications: listing.containerApplications.ofThisStack,
  durableObjectNamespaces: listing.durableObjectNamespaces.ofThisStack,
  r2Buckets: listing.r2Buckets.ofThisStack,
  hyperdriveConfigurations: listing.hyperdriveConfigurations.ofThisStack,
  neonBranches: listing.neonBranches.names,
  imageRepositories: listing.imageRepositories.ofThisStack,
});

/** Every name in a listing that carries one of these worlds' stages. */
export const namesOfWorlds = (listing: StackListing, stages: ReadonlyArray<string>): ReadonlyArray<string> =>
  Arr.filter(
    Arr.flatten([
      listing.workers,
      listing.containerApplications,
      listing.durableObjectNamespaces,
      listing.r2Buckets,
      listing.hyperdriveConfigurations,
      listing.neonBranches,
    ]),
    (name) => Arr.some(stages, (stage) => Str.includes(`-${stage}-`)(name) || Str.endsWith(`/${stage}`)(name)),
  );
