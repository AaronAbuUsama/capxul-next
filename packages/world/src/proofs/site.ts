// The proof of a world's company site on a shared bench (roadmap step 1.4), on the bench `WORLD_BENCH` names:
//
//   1. a world made with one company gets its site, made by the bench's site door with the world's own token, on
//      the world's clock, with an API user of its own;
//   2. the site is read through the door with that user's credential: the company's record, its Suppliers, who
//      the call ran as (never the bench's Administrator), and the site's clock;
//   3. a second world's token is refused for the first world's site, and the second world sees none of its sites;
//   4. both worlds are destroyed: the site is removed with its world, and neither account nor the bench holds
//      anything of them afterwards.
//
// What Core's world door answers for the site is recorded too: on a stand-in bench with no edge (PLATFORM_EDGE=none),
// Core, on Cloudflare, cannot reach the door, and its probe must say so as the site door's typed failure.
import * as Arr from "effect/Array";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import * as Str from "effect/String";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { PROBE_PATH } from "@capxul/core";
import { ProofFailed } from "../failures.ts";
import { describe } from "../lifecycle/describe.ts";
import { withWorld } from "../lifecycle/run.ts";
import type { World } from "../lifecycle/spec.ts";
import { BenchStage, readSite, sitesOn } from "../site/Bench.ts";
import { check, conclude, inventoryReport, stackListing } from "./support.ts";

const lifetime = Duration.hours(1);
const ACME = { label: "acme", name: "Acme Ltd" };
const FIRST = "p-site";
const SECOND = "p-site2";

const words = (line: string) => Arr.filter(Str.split(Str.trim(line), " "), Str.isNonEmpty);

/** What the bench itself holds: its site folders, the door's registry and MariaDB's databases. */
const benchHolds = (bench: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const script =
        'cd /home/frappe/frappe-bench/sites && ls -A | tr "\\n" " "; echo; ls -A .capxul-door | tr "\\n" " "; echo; ' +
        'mariadb -h mariadb -uroot -p"$DB_ROOT_PASSWORD" -N -e "show databases" | tr "\\n" " "';
      const handle = yield* spawner.spawn(
        ChildProcess.make("docker", ["exec", `cx-platform-${bench}-door`, "bash", "-c", script]),
      );
      const out = yield* handle.stdout.pipe(Stream.decodeText(), Stream.mkString);
      const [folders, registry, databases] = [...Str.split(out, "\n"), "", "", ""];
      return { folders: words(folders), registry: words(registry), databases: words(databases) };
    }),
  );

/** Core's probe at a world's door: one read of a site, as Core's SiteDoor makes it. */
const probe = (world: World, path: string, site?: string) =>
  Effect.gen(function* () {
    const query = site === undefined ? "" : `&site=${site}`;
    const response = yield* HttpClient.execute(
      HttpClientRequest.get(`${world.coreUrl}${PROBE_PATH}?path=${path}${query}`).pipe(
        HttpClientRequest.setHeader("authorization", `Bearer ${Redacted.value(world.doorToken)}`),
      ),
    );
    return { status: response.status, body: yield* response.json };
  }).pipe(Effect.scoped);

const field = (body: unknown, ...path: ReadonlyArray<string>): unknown =>
  Arr.reduce(path, body, (at, key) => (Predicate.hasProperty(at, key) ? at[key] : undefined));

/** What the first world's use sees: its site, read through the door, and the second world, refused. */
const useFirst = (bench: string) => (first: World) =>
  Effect.gen(function* () {
    const made = yield* Effect.fromOption(Arr.head(first.sites)).pipe(
      Effect.mapError(() => ProofFailed.make({ message: "the world was made with no site" })),
    );
    const read = (path: string) => readSite(first.stage, bench, first.stage, made.site, path);
    const company = yield* read("/api/resource/Company");
    const suppliers = yield* read("/api/resource/Supplier");
    const runsAs = yield* read("/api/method/frappe.auth.get_logged_user");
    const clock = yield* read("/api/method/capxul.clock.now");
    const coreProbe = yield* probe(first, "/api/resource/Company");
    const second = yield* withWorld({ name: SECOND, owner: "proof", lifetime }, (other) =>
      Effect.gen(function* () {
        // The second world's own token, with the first world's credential: only the token differs.
        const refused = yield* readSite(other.stage, bench, first.stage, made.site, "/api/resource/Company");
        const seen = yield* sitesOn(other.stage, bench);
        const theirProbe = yield* probe(other, "/api/resource/Company", made.site);
        return { refused, seen, coreProbe: theirProbe };
      }),
    );
    const used = Option.getOrUndefined(second.used);
    if (used === undefined || Exit.isFailure(used))
      return yield* ProofFailed.make({
        message: `the second world's run did not pass: ${used === undefined ? "never used" : describe(used.cause)}`,
      });
    return { made, company, suppliers, runsAs, clock, coreProbe, second: used.value, secondRecord: second.record };
  });

export const site = Effect.gen(function* () {
  const bench = yield* Effect.fromOption(yield* BenchStage).pipe(
    Effect.mapError(() => ProofFailed.make({ message: "set WORLD_BENCH to the platform stage of a bench" })),
  );
  const before = yield* stackListing;
  const benchBefore = yield* benchHolds(bench);
  const first = yield* withWorld({ name: FIRST, owner: "proof", lifetime, companies: [ACME] }, useFirst(bench));
  const after = yield* stackListing;
  const benchAfter = yield* benchHolds(bench);
  const firstLeft = yield* sitesOn(`w-${FIRST}`, bench);
  const secondLeft = yield* sitesOn(`w-${SECOND}`, bench);
  const used = Option.getOrUndefined(first.used);
  const seen = used !== undefined && Exit.isSuccess(used) ? used.value : undefined;
  const inventory = inventoryReport(before, after, [`w-${FIRST}`, `w-${SECOND}`]);
  const siteName = seen?.made.site ?? "";
  const onBench = (holds: typeof benchAfter) =>
    Arr.some([...holds.folders, ...holds.registry], (entry) => Str.includes(`-${FIRST}`)(entry));
  return yield* conclude(
    "site",
    "a world made with a company gets the company's Frappe site on the shared bench, made by the site door with the world's own token, read through the door on the site's own API user; a second world's token is refused for it; destroying the world removes the site, and neither account nor the bench holds anything of either world afterwards. Core's world door reaching the site is recorded, not proven: the stand-in bench has no edge",
    [
      check("the first world's run passed", seen !== undefined),
      check("the world was made with its company's site, ready", seen?.made.state === "ready"),
      check(
        "the site is <label>-<world>.<domain>, joined to the world",
        Str.startsWith(`acme-${FIRST}.`)(siteName) && seen?.made.world === FIRST,
      ),
      check(
        "the door read the company's record from the site",
        seen?.company.status === 200 && Str.includes(ACME.name)(String(field(seen.company.body, "data", "0", "name"))),
      ),
      check("the door read the Supplier list from the site", seen?.suppliers.status === 200),
      check(
        "the read ran as the site's own API user, not the bench's Administrator",
        field(seen?.runsAs.body, "message") === "capxul-core@service.invalid",
      ),
      check("the site reads its world's clock", field(seen?.clock.body, "message", "world") === FIRST),
      check(
        "the second world's token is refused for the first world's site",
        seen?.second.refused.status === 403 && field(seen.second.refused.body, "refused") === "site-not-in-world",
      ),
      check("the second world sees none of its sites on the bench", seen?.second.seen.length === 0),
      check(
        "Core's probe at the world's door answers the site door's typed failure: the stand-in door is not reachable from Cloudflare",
        field(seen?.coreProbe.body, "failed", "reason") === "unreachable",
      ),
      check("the second world was destroyed", seen?.secondRecord.worldAfterwards === "destroyed"),
      check("the first world was destroyed", first.record.worldAfterwards === "destroyed"),
      check(
        "the site was removed with its world: the door holds no site of either",
        firstLeft.length === 0 && secondLeft.length === 0,
      ),
      check("the bench holds nothing of the world afterwards: no folder, no registry entry", !onBench(benchAfter)),
      check(
        "the bench's databases are as before",
        Arr.join(Arr.sort(benchAfter.databases, Str.Order), " ") ===
          Arr.join(Arr.sort(benchBefore.databases, Str.Order), " "),
      ),
      // The accounts are shared: another agent's worlds may come and go during the run, so the check is on these two.
      check("neither account holds anything of either world afterwards", inventory.leftOfTheseWorlds.length === 0),
    ],
    {
      bench,
      site: seen?.made ?? null,
      reads:
        seen === undefined
          ? null
          : { company: seen.company, suppliers: seen.suppliers, runsAs: seen.runsAs, clock: seen.clock },
      coreProbe: seen?.coreProbe ?? null,
      second: seen?.second ?? null,
      runs: { first: first.record, second: seen?.secondRecord ?? null },
      onTheBench: { before: benchBefore, after: benchAfter, sitesLeft: { first: firstLeft, second: secondLeft } },
      inventory,
    },
  );
});
