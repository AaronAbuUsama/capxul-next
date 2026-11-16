// Bench templates: what a template is named, what code made it, and the sweep that removes old ones (docs/roadmap.md,
// decision "Bench templates never change", 14 November 2026; packages/platform, door/templates.py).
//
//   name   `<starting world>-<code>-<world>`: the starting world it holds, the first 8 hex digits of the code
//          fingerprint below, and the world whose sites it copies. A template's sites hold that world's company facts
//          (the org id Core drew at random, the Safe minted under it, its approvals' and payments' ids), so only a
//          world holding that world's chain state and database can claim it: the world itself, reset to its snapshot.
//          The world's name makes the name that world's alone, so no run ever asks for another run's template, and
//          the door never changes one that exists.
//   code   a sha256 over every file of the sources a caller names (the blueprint's starting worlds, Core, this
//          package and the runner's makers) and the apps the bench makes sites with (`GET /health`'s `app`)
//   sweep  `POST /templates/sweep`: the door removes every template last used more than `WORLD_TEMPLATE_IDLE` ago
//          (6 hours; a run's world lives 150 minutes, and only it claims its templates), never one in use
import * as Arr from "effect/Array";
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import * as Digest from "effect/crypto/Digest";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { SiteFailed } from "../../common/failures.ts";
import { describe, describeFailure } from "../../common/describe.ts";
import { BenchStage, doorOf, soon, tokenFor } from "../site/bench.ts";
import { doorJob } from "../site/client.ts";

/** The door's rule for a template's name (door/templates.py, TEMPLATE). */
const TEMPLATE = /^[a-z][a-z0-9-]{0,39}$/;

/** How long a template may go unused before the sweep removes it. */
export const TemplateIdle = Config.Duration("WORLD_TEMPLATE_IDLE").pipe(Config.withDefault(Duration.hours(6)));

/** The name of the template of `startingWorld` that world `world` keeps, made by the code `code` fingerprints. */
export const templateName = (startingWorld: string, code: string, world: string) =>
  Effect.gen(function* () {
    const name = `${startingWorld}-${Str.slice(0, 8)(code)}-${world}`;
    if (!/^[0-9a-f]{8}$/.test(Str.slice(0, 8)(code)) || !TEMPLATE.test(name))
      return yield* SiteFailed.make({ step: "template", message: `${name} is not a template's name` });
    return name;
  });

const Health = Schema.Struct({ ok: Schema.Boolean, app: Schema.optional(Schema.String) });

/** The apps the bench makes sites with, as its door hashes them; `unknown` for a door from before it said. */
const benchApps = (bench: string) =>
  Effect.gen(function* () {
    const { door } = yield* doorOf(bench);
    const response = yield* HttpClient.execute(HttpClientRequest.get(`${door}/health`));
    const health = yield* HttpClientResponse.schemaBodyJson(Health)(response);
    return health.app ?? "unknown";
  }).pipe(
    Effect.scoped,
    Effect.mapError((error) => SiteFailed.make({ step: "door", message: describeFailure(error) })),
  );

/** Every file under `dir`, relative to `root`, sorted; folders named node_modules are not read. */
const filesUnder = (root: string, dir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const found = yield* fs.readDirectory(path.join(root, dir), { recursive: true });
    const files = yield* Effect.filter(
      Arr.filter(found, (entry) => !Str.includes("node_modules")(entry)),
      (entry) => Effect.map(fs.stat(path.join(root, dir, entry)), (info) => info.type === "File"),
    );
    return Arr.sort(
      Arr.map(files, (entry) => path.join(dir, entry)),
      Order.String,
    );
  });

/** The fingerprint of every file under each of `dirs` (relative to `root`), by path and content, and of `apps`. Hex. */
export const fingerprintOf = (root: string, dirs: ReadonlyArray<string>, apps: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const digest = yield* Digest.Digest;
    const files = Arr.flatten(yield* Effect.forEach(dirs, (dir) => filesUnder(root, dir)));
    const lines = yield* Effect.forEach(files, (file) =>
      Effect.flatMap(fs.readFile(path.join(root, file)), (bytes) =>
        Effect.map(digest.digestHex(Digest.sha256, bytes), (hash) => `${file} ${hash}`),
      ),
    );
    return yield* digest.digestHex(
      Digest.sha256,
      new TextEncoder().encode(Arr.join([`bench ${apps}`, ...lines], "\n")),
    );
  });

/**
 * The fingerprint of the code that makes a template: every file under each of `dirs` (relative to `root`), and the
 * apps of the bench `WORLD_BENCH` names, as its door hashes them. Hex.
 */
export const templateCode = Effect.fn("world.template.code")(function* (root: string, dirs: ReadonlyArray<string>) {
  const bench = yield* BenchStage;
  const apps = Option.isSome(bench) ? yield* benchApps(bench.value) : "none";
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- WebCrypto's digest is the platform's own layer, used for this one fingerprint
  return yield* fingerprintOf(root, dirs, apps).pipe(Effect.provide(Digest.layerWebCrypto));
});

const Swept = Schema.Struct({
  removed: Schema.Array(Schema.Struct({ template: Schema.String })),
  kept: Schema.Array(Schema.Struct({ template: Schema.String })),
  busy: Schema.Array(Schema.String),
});

/** What a sweep did with the bench's templates. `detail` says why it did nothing (no bench, or a door that cannot). */
export const TemplatesSwept = Schema.Struct({
  removed: Schema.Array(Schema.String),
  kept: Schema.Array(Schema.String),
  busy: Schema.Array(Schema.String),
  detail: Schema.NullOr(Schema.String),
});
export type TemplatesSwept = typeof TemplatesSwept.Type;

/** The world name a sweep's token is minted for: no world's, so it holds no site and may make none (quota 0). */
export const SWEEPER = "sweeper";

/**
 * Asks the bench `WORLD_BENCH` names to remove every template unused for `WORLD_TEMPLATE_IDLE`. A sweep never fails
 * on it: a bench it cannot reach, or a door from before the sweep, is said in `detail`.
 */
export const sweepTemplates = (dryRun: boolean) =>
  Effect.gen(function* () {
    const bench = yield* BenchStage;
    if (Option.isNone(bench)) return { removed: [], kept: [], busy: [], detail: "no bench (WORLD_BENCH unset)" };
    const idle = yield* TemplateIdle;
    const { door, token } = yield* tokenFor(bench.value, SWEEPER, 0, yield* soon);
    const swept = yield* doorJob(
      door,
      token,
      HttpClientRequest.post("/templates/sweep").pipe(
        HttpClientRequest.bodyJsonUnsafe({ idle_s: Math.round(Duration.toSeconds(idle)), dry_run: dryRun }),
      ),
      Swept,
    );
    return {
      removed: Arr.map(swept.removed, (each) => each.template),
      kept: Arr.map(swept.kept, (each) => each.template),
      busy: swept.busy,
      detail: null,
    } satisfies TemplatesSwept;
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.succeed<TemplatesSwept>({ removed: [], kept: [], busy: [], detail: describe(cause) }),
    ),
  );
