// What a snapshot's save reaches, stood in for beside platform-stand-in.ts (test/snapshot-save.test.ts): Neon making a
// branch (locked with a 423, refused, or slow, so its requests in flight can be counted), the hub's index stop and
// resume and its chain's save, and the bench's door saving the world's sites and their point. The bench can hold its
// sites' answer until the hub has been asked to save the chain, as a door that backs the sites up beside the chain does.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Str from "effect/String";

/** What the save's stand-ins hold and saw; every field left out is a stand-in that answers at once and succeeds. */
export interface Saving {
  /**
   * A snapshot's save, as the stand-ins saw it: each step the hub, Neon and the bench were asked for, in order
   * (`index stop`, `branch`, `chain save <name>`, `index resume`, `sites saved <name>`, `kept <name>`, ...).
   */
  saving?: Array<string>;
  /** The bench's door holds its sites' answer until the hub has been asked to save the chain of that name. */
  holdSitesSave?: boolean;
  /** How many of Neon's next branch requests answer 423, the project locked. */
  neonLocked?: number;
  /** Neon answers a branch's making only after this long, so branch requests can be counted in flight. */
  neonHoldMs?: number;
  /** Neon's branch requests in flight now, and the most there ever were at once. */
  neonInFlight?: { now: number; most: number };
  /** The hub fails a chain's save; Neon fails a branch's making. */
  failChain?: boolean;
  failBranch?: boolean;
  /** The project's branches, as platform-stand-in.ts keeps them. */
  branches: Array<{ readonly id: string; readonly name: string; readonly parent_id?: string }>;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const NEON_BRANCHES = "/api/v2/projects/project/branches";
const HUB = /^\/w-[a-z0-9-]+\.[0-9a-f]+\/(index\/stop|index\/resume|chain\/snapshot\/([a-z0-9-]+))$/;

/** The string field `field` of a request's JSON body, or "". */
const fieldOf = (body: unknown, field: string) =>
  typeof body === "object" && body !== null && field in body ? String(Reflect.get(body, field)) : "";

/** Whether the hub has been asked to save the chain of snapshot `name`. */
const chainSaved = (outside: Saving, name: string) =>
  Arr.some(outside.saving ?? [], (step) => step === `chain save ${name}`);

/** The save's stand-ins' answer to `request`; undefined for one they do not stand in for. */
export const saveAnswer = (outside: Saving, url: URL, request: Request, body: unknown): Response | undefined => {
  if (url.hostname === "console.neon.tech" && url.pathname === NEON_BRANCHES && request.method === "POST") {
    if ((outside.neonLocked ?? 0) > 0) {
      outside.neonLocked = (outside.neonLocked ?? 0) - 1;
      outside.saving?.push("branch locked");
      return json({ message: "project already has running operations" }, 423);
    }
    if (outside.failBranch === true) return json({ message: "branch refused" }, 500);
    const asked = typeof body === "object" && body !== null && "branch" in body ? body.branch : null;
    const made = { id: `br-made-${outside.branches.length}`, name: "made", parent_id: fieldOf(asked, "parent_id") };
    outside.branches = [...outside.branches, made];
    outside.saving?.push("branch");
    return json({ branch: { id: made.id }, operations: [] });
  }
  const hub = HUB.exec(url.pathname);
  if (url.hostname === "hub.test" && request.method === "POST" && hub !== null) {
    const [, path = "", saved] = hub;
    if (saved === undefined) {
      outside.saving?.push(Str.replace("/", " ")(path));
      return json({});
    }
    outside.saving?.push(`chain save ${saved}`);
    return outside.failChain === true ? json({ error: "anvil did not answer" }, 500) : json({ head: "0x1", bytes: 1 });
  }
  if (url.hostname === "bench.test" && request.method === "POST" && url.pathname === "/world/backup") {
    const snapshot = fieldOf(body, "snapshot");
    outside.saving?.push(`sites saved ${snapshot}`);
    return json({ world: "stand-in", snapshot, sites: [{ site: "northwind.pool.test", label: "a", ms: 1 }] });
  }
  if (url.hostname === "bench.test" && request.method === "POST" && url.pathname === "/world/save") {
    const point = fieldOf(body, "point");
    outside.saving?.push(`point saved ${point}`);
    return json({ world: "stand-in", point });
  }
  return undefined;
};

/** What the save's stand-ins do before they answer: the bench holding its sites, and Neon taking its time. */
export const beforeSaveAnswer = (outside: Saving, web: Request, body: unknown) =>
  Effect.gen(function* () {
    const url = new URL(web.url);
    if (outside.holdSitesSave === true && url.hostname === "bench.test" && url.pathname === "/world/backup")
      while (!chainSaved(outside, fieldOf(body, "snapshot"))) yield* Effect.sleep("20 millis");
    if (
      outside.neonHoldMs !== undefined &&
      url.hostname === "console.neon.tech" &&
      url.pathname === NEON_BRANCHES &&
      web.method === "POST"
    ) {
      const counted = (outside.neonInFlight ??= { now: 0, most: 0 });
      counted.now += 1;
      counted.most = Math.max(counted.most, counted.now);
      yield* Effect.sleep(`${outside.neonHoldMs} millis`);
      counted.now -= 1;
    }
  });
