// The generic `sites` check over a whole run (roadmap 4.8, option 2: ready company copies at the bench's door). Every
// company site the run founded must say where it came from (`SiteOrigin`) and the door's steps that made it; when the
// run's preparation readied k company copies, the first min(k, sites founded) must be taken from that pool; and every
// site not taken from the pool must be explained by a `site.make.fell_back` log naming why (`MakeFallback`). It never
// fails on speed: each site's time and its steps' times are reported beside the checks, never judged. Pure; no scenario
// writes it, and a builder never changes it.
import { Pipeline } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import type { Check } from "./checks.ts";

export type SiteOrigin = typeof Pipeline.SiteOrigin.Type;
export type MakeFallback = typeof Pipeline.MakeFallback.Type;

/** One step the door took to make a site: its declared span's name and how long it took. */
export interface SiteStep {
  readonly span: string;
  readonly ms: number | null;
}

/** One company site the run founded, in the order the run asked for them, as the run record keeps it. */
export interface SiteMade {
  readonly world: string;
  /** The company's handle. */
  readonly company: string;
  /** Where it came from; null when the record says nothing of it. */
  readonly origin: SiteOrigin | null;
  readonly steps: ReadonlyArray<SiteStep>;
  /** From the request to the site answering as ready; null when not measured. */
  readonly ms: number | null;
}

/** A `site.make.fell_back` log, as the run record keeps it. */
export interface FellBack {
  readonly world: string;
  readonly origin: SiteOrigin;
  readonly reason: MakeFallback;
}

/** What the check reads: the sites founded, in order, the ready company copies prepare recorded, and the fallbacks. */
export interface SitesSeen {
  readonly founded: ReadonlyArray<SiteMade>;
  /** How many ready company copies the run's preparation recorded in the pool; 0 when it readied none. */
  readonly readyCopies: number;
  readonly fellBack: ReadonlyArray<FellBack>;
}

/** One site's times, reported and never judged. */
export interface SiteTimes {
  readonly world: string;
  readonly company: string;
  readonly origin: SiteOrigin | null;
  readonly ms: number | null;
  readonly steps: ReadonlyArray<SiteStep>;
}

const POOL: SiteOrigin = "company pool";
const spans = Pipeline.siteMake.spans;

const named = (site: SiteMade) => `${site.company} in ${site.world}`;

/** The steps a site made from a ready company copy must name: the take and the join. */
const POOL_STEPS = [spans.take.name, spans.join.name] as const;

/** One `sites` check: it holds when nothing failed it. */
const check = (failures: ReadonlyArray<string>): Check => ({
  check: "sites",
  passed: failures.length === 0,
  detail: Arr.join(failures, "; "),
});

/** The run's `sites` checks over its founded sites, and their times, reported. */
export const checkSites = (
  seen: SitesSeen,
): { readonly checks: ReadonlyArray<Check>; readonly times: ReadonlyArray<SiteTimes> } => {
  const unexplained = Arr.flatMap(seen.founded, (site) =>
    site.origin === null
      ? [`${named(site)} is unexplained: the record names no origin`]
      : site.steps.length === 0
        ? [`${named(site)} is unexplained: the record names no steps`]
        : site.origin === POOL && !Arr.every(POOL_STEPS, (step) => Arr.some(site.steps, (each) => each.span === step))
          ? [`${named(site)} came from the company pool, but its steps do not name ${Arr.join(POOL_STEPS, " and ")}`]
          : [],
  );
  const expected = Math.min(seen.readyCopies, seen.founded.length);
  const notFromPool = Arr.flatMap(Arr.take(seen.founded, expected), (site, index) =>
    site.origin === POOL
      ? []
      : [
          `site ${index + 1} of ${expected} the pool's ${seen.readyCopies} ready copies covered, ${named(site)}, came from ${site.origin ?? "nowhere recorded"}`,
        ],
  );
  // Each site not taken from the pool needs a fallback log of its world and origin; each log explains one site.
  const unused = [...seen.fellBack];
  const silent = Arr.flatMap(seen.founded, (site) => {
    if (site.origin === null || site.origin === POOL) return [];
    const index = Arr.findFirstIndex(unused, (log) => log.world === site.world && log.origin === site.origin);
    if (Option.isNone(index))
      return [`${named(site)} came from ${site.origin} with no ${Pipeline.siteMake.logs.fellBack.name} saying why`];
    unused.splice(index.value, 1);
    return [];
  });
  return {
    checks: [check(unexplained), check(notFromPool), check(silent)],
    times: Arr.map(seen.founded, (site) => ({
      world: site.world,
      company: site.company,
      origin: site.origin,
      ms: site.ms,
      steps: site.steps,
    })),
  };
};
