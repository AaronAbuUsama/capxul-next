// What the two accounts hold, read straight from Cloudflare's and Neon's own APIs, not from Alchemy's state: the
// listing that shows a destroy left nothing behind, and the image repositories that `alchemy destroy` does leave.
// Both accounts hold the owner's real projects, so everything here names only what starts with this stack's name.
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { IMAGE_PREFIX, STACK } from "../stack/names.ts";

export class AccountUnreadable extends Schema.TaggedError<AccountUnreadable>()("AccountUnreadable", {
  what: Schema.String,
  status: Schema.Number,
  message: Schema.String,
}) {}

const settings = Config.all({
  account: Config.String("CLOUDFLARE_ACCOUNT_ID"),
  cloudflare: Config.Redacted("CLOUDFLARE_API_TOKEN"),
  neon: Config.Redacted("NEON_API_KEY"),
  org: Config.String("NEON_ORG_ID"),
});

const REGISTRY = "https://registry.cloudflare.com";
const MANIFESTS =
  "application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json";

/** Sends one request and gives back the status and the body's text. */
const send = (what: string, request: HttpClientRequest.HttpClientRequest) =>
  HttpClient.execute(request).pipe(
    Effect.flatMap((response) => Effect.map(response.text, (body) => ({ status: response.status, body }))),
    Effect.scoped,
    Effect.mapError((error) => new AccountUnreadable({ what, status: 0, message: String(error).slice(0, 200) })),
  );

const getJson = <S extends Schema.Top>(what: string, url: string, token: Redacted.Redacted<string>, schema: S) =>
  send(what, HttpClientRequest.get(url).pipe(HttpClientRequest.bearerToken(Redacted.value(token)))).pipe(
    Effect.flatMap(({ status, body }) =>
      status === 200
        ? Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(body).pipe(
            Effect.mapError((error) => new AccountUnreadable({ what, status, message: String(error.message).slice(0, 200) })),
          )
        : Effect.fail(new AccountUnreadable({ what, status, message: body.slice(0, 200) })),
    ),
  );

const named = (key: string) => Schema.Struct({ result: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)) }).pipe(
  Schema.decodeTo(Schema.Array(Schema.String), {
    decode: (answer: { readonly result: ReadonlyArray<Record<string, unknown>> }) => answer.result.map((item) => String(item[key] ?? "")),
    encode: () => ({ result: [] }),
  } as never),
);

const mine = (names: ReadonlyArray<string>) => names.filter((name) => name.toLowerCase().startsWith(STACK.toLowerCase()));
const count = (names: ReadonlyArray<string>) => ({ inAccount: names.length, ofThisStack: mine(names) });

const Buckets = Schema.Struct({ result: Schema.Struct({ buckets: Schema.Array(Schema.Struct({ name: Schema.String })) }) });
const Projects = Schema.Struct({ projects: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })) });
const Branches = Schema.Struct({ branches: Schema.Array(Schema.Struct({ name: Schema.String })) });
const Items = Schema.Struct({ result: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)) });
const Catalog = Schema.Struct({ repositories: Schema.optional(Schema.Array(Schema.String)) });
const Tags = Schema.Struct({ tags: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))) });
const Credentials = Schema.Struct({ result: Schema.Struct({ username: Schema.optional(Schema.String), password: Schema.String }) });

/**
 * Takes the expiry Neon itself enforces off a branch. Neon refuses to fork a branch that has one ("Branches with an
 * expiration date cannot have child branches"), so a world that another is made from stops being deleted by Neon
 * and is deleted by the sweeper alone, at the same recorded expiry.
 */
export const liftBranchExpiry = Effect.fn("world.account.liftBranchExpiry")(function* (projectId: string, branchId: string) {
  const { neon } = yield* settings;
  const { status, body } = yield* send(
    "neon branch expiry",
    HttpClientRequest.patch(`https://console.neon.tech/api/v2/projects/${projectId}/branches/${branchId}`).pipe(
      HttpClientRequest.bearerToken(Redacted.value(neon)),
      HttpClientRequest.bodyJsonUnsafe({ branch: { expires_at: null } }),
    ),
  );
  if (status >= 300) return yield* new AccountUnreadable({ what: "neon branch expiry", status, message: body.slice(0, 200) });
});

/** A short-lived way in to Cloudflare's image registry, as a Basic authorization header value. */
const registryAuth = Effect.gen(function* () {
  const { account, cloudflare } = yield* settings;
  const { status, body } = yield* send(
    "registry credentials",
    HttpClientRequest.post(`https://api.cloudflare.com/client/v4/accounts/${account}/containers/registries/registry.cloudflare.com/credentials`).pipe(
      HttpClientRequest.bearerToken(Redacted.value(cloudflare)),
      HttpClientRequest.bodyJsonUnsafe({ expiration_minutes: 5, permissions: ["pull", "push"] }),
    ),
  );
  if (status >= 300) return yield* new AccountUnreadable({ what: "registry credentials", status, message: body.slice(0, 200) });
  const { result } = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Credentials))(body).pipe(
    Effect.mapError((error) => new AccountUnreadable({ what: "registry credentials", status, message: String(error.message).slice(0, 200) })),
  );
  return Redacted.make(`Basic ${btoa(`${result.username ?? "v1"}:${result.password}`)}`);
});

const registryCall = (auth: Redacted.Redacted<string>, method: "GET" | "DELETE" | "PUT", path: string) =>
  send(
    `registry ${method} ${path}`,
    HttpClientRequest.make(method)(`${REGISTRY}${path}`).pipe(
      HttpClientRequest.setHeader("Authorization", Redacted.value(auth)),
      HttpClientRequest.setHeader("Accept", MANIFESTS),
    ),
  );

const decodeBody = <S extends Schema.Top>(what: string, schema: S) => (answer: { readonly status: number; readonly body: string }) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(answer.body).pipe(
    Effect.mapError((error) => new AccountUnreadable({ what, status: answer.status, message: String(error.message).slice(0, 200) })),
  );

/** The names of this stack's image repositories in Cloudflare's registry, without the account id in front. */
export const imageRepositories = Effect.gen(function* () {
  const auth = yield* registryAuth;
  const catalog = yield* registryCall(auth, "GET", "/v2/_catalog").pipe(Effect.flatMap(decodeBody("registry catalog", Catalog)));
  const names = (catalog.repositories ?? []).map((name) => name.split("/").at(-1) ?? name);
  return { inAccount: names.length, ofThisStack: names.filter((name) => name.startsWith(IMAGE_PREFIX)) };
}).pipe(Effect.withSpan("world.account.images"));

/** How many times a repository's references are listed and deleted before it is given up on. */
const ROUNDS = 5;

/**
 * Empties the named repositories and asks the registry to collect what they held. Deleting a tag can leave the
 * manifests it pointed at, which the registry then lists by digest, so each repository is listed and emptied again
 * until it lists nothing. Whether a repository is really gone is for the caller to read back.
 */
export const removeImageRepositories = Effect.fn("world.account.removeImages")(function* (repositories: ReadonlyArray<string>) {
  if (repositories.length === 0) return;
  const { account } = yield* settings;
  const auth = yield* registryAuth;
  const empty = (path: string, round: number): Effect.Effect<void, AccountUnreadable, HttpClient.HttpClient> =>
    Effect.gen(function* () {
      const listed = yield* registryCall(auth, "GET", `${path}/tags/list`);
      if (listed.status !== 200) return;
      const { tags } = yield* decodeBody("registry tags", Tags)(listed);
      if (tags === undefined || tags === null || tags.length === 0 || round >= ROUNDS) return;
      yield* Effect.forEach(tags, (reference) => registryCall(auth, "DELETE", `${path}/manifests/${reference}`));
      yield* empty(path, round + 1);
    });
  yield* Effect.forEach(repositories, (repository) => empty(`/v2/${account}/${repository}`, 0));
  yield* registryCall(auth, "PUT", "/v2/gc/layers");
});

/** Everything of the kinds a world creates, counted in the two accounts, with what belongs to this stack named. */
export const inventory = Effect.gen(function* () {
  const { account, cloudflare, neon, org } = yield* settings;
  const cf = `https://api.cloudflare.com/client/v4/accounts/${account}`;
  const list = (what: string, path: string, key: string) =>
    getJson(what, `${cf}${path}`, cloudflare, Items).pipe(Effect.map((answer) => answer.result.map((item) => String(item[key] ?? ""))));
  const projects = yield* getJson("neon projects", `https://console.neon.tech/api/v2/projects?org_id=${org}&limit=400`, neon, Projects);
  const ours = projects.projects.filter((project) => project.name.toLowerCase().startsWith(STACK.toLowerCase()));
  const branches = yield* Effect.forEach(ours, (project) =>
    getJson("neon branches", `https://console.neon.tech/api/v2/projects/${project.id}/branches`, neon, Branches).pipe(
      Effect.map((answer) => answer.branches.map((branch) => `${project.name}/${branch.name}`)),
    ),
  );
  return {
    workers: count(yield* list("workers", "/workers/scripts", "id")),
    containerApplications: count(yield* list("container applications", "/containers/applications", "name")),
    durableObjectNamespaces: count(yield* list("durable object namespaces", "/workers/durable_objects/namespaces?per_page=1000", "script")),
    r2Buckets: count((yield* getJson("r2 buckets", `${cf}/r2/buckets?per_page=1000`, cloudflare, Buckets)).result.buckets.map((bucket) => bucket.name)),
    hyperdriveConfigurations: count(yield* list("hyperdrive configurations", "/hyperdrive/configs", "name")),
    neonProjects: count(projects.projects.map((project) => project.name)),
    neonBranches: { inThisStacksProjects: branches.flat().length, names: branches.flat() },
    imageRepositories: yield* imageRepositories,
  };
}).pipe(Effect.withSpan("world.account.inventory"));
