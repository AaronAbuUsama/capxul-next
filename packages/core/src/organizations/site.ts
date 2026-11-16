// A company's site on the world's bench, through Core's SiteDoor. org.create starts making it; the site must then be
// told what the chain says: its company and Safe, each hat a person of the world wears (which gives them a user and
// its roles, packages/frappe-app capxul/hats.py), and the founder's capital (capxul/capital.py). Those are queued
// with the change that causes them (`app.site_deliveries`) and handed to the site, in order, once it is ready. A site
// is ready for the world (`app.companies.site_state`) when the door has made it, the setup has landed and the site
// has taken every delivery queued so far.
//
// Nothing runs in the background of a Worker: `reconcile` moves a company's site on, and is run after the setup or a
// grant lands and whenever the world's companies are read (`companiesOf`, for world.show). Why:
// packages/blueprint, src/common/values.ts.
import type { Values } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Str from "effect/String";
import * as PgClient from "@effect/sql-pg/PgClient";
import { WorldClock } from "../site-ops/clock.ts";
import { SiteDoor } from "../site/SiteDoor.ts";
import * as Store from "./store.ts";

/** The site's hat for each permission and for a Director: the shipped hat map (capxul/setup.py, DEFAULT_HAT_ROLES). */
export const SITE_HATS = {
  director: "admin",
  "manage-books": "budget-holder",
  "issue-invoices": "sales",
  "manage-people": "hr-manager",
} as const;

/** The Frappe methods of the Capxul app that take each delivery (capxul/core_company.py). */
const METHOD = {
  configure: "/api/method/capxul.core_company.configure",
  grant: "/api/method/capxul.core_company.grant",
  capital: "/api/method/capxul.core_company.capital",
  paid: "/api/method/capxul.core_company.paid",
  /** Not a site's method: the bench's own clock, set to the world's through the door (door.py, `POST /clock`). */
  clock: "/clock",
} as const;
export type DeliveryKind = keyof typeof METHOD;

/** A site's label: the handle's letters and digits, at most 12 (the door's rule). */
const labelOf = (handle: string) => Str.slice(0, 12)(Str.replace(/[^a-z0-9]/g, "")(handle));

/** Starts making the company's site. With no bench, or a door that refuses, the company has no site yet. */
export const startSite = Effect.fn("site.start")(function* (org: string, handle: string, name: string) {
  const door = yield* SiteDoor;
  const sql = yield* PgClient.PgClient;
  const made = yield* door.make(labelOf(handle), name).pipe(Effect.option);
  if (Option.isSome(made)) yield* sql.withTransaction(Store.setSite(org, made.value.site, "creating"));
});

/** Queues what the site must be told, inside the transaction of the change that causes it. */
export const deliver = Effect.fn("site.queue")(function* (
  org: string,
  kind: DeliveryKind,
  body: Record<string, unknown>,
) {
  const sql = yield* PgClient.PgClient;
  yield* sql`insert into app.site_deliveries (org, kind, body) values (${org}, ${kind}, ${sql.json({ ...body, org })})`;
});

interface Pending {
  readonly id: string;
  readonly kind: DeliveryKind;
  readonly body: unknown;
}

/** The door's refusal for a site it does not hold: one Core made, then lost (door.py, `site_of`). */
const NOT_IN_WORLD = "site-not-in-world";
const LOST = "lost";
const UNREACHABLE = "unreachable";

/**
 * What a site the door did not finish comes to. One the door lost, or stopped making only because it restarted
 * (`interrupted`, door.py), is made again, once; one the door could not make (`failed`), or lost a second time, stops.
 */
export const afterFailure = (state: string, restarts: number): "again" | "stop" =>
  (state === "interrupted" || state === LOST) && restarts < 1 ? "again" : "stop";

/**
 * Moves one company's site on: makes it if it was never started, reads its state from the door (`afterFailure` for
 * one it did not finish), and once the door has made it, hands it every delivery still queued, in order, stopping at
 * the first it does not take. The world sees the site ready only when nothing is left to deliver and the setup has
 * landed.
 */
export const reconcile = Effect.fn("site.reconcile")(function* (org: string) {
  // nameOf and makeAgain are steps of `reconcile` for this company, held inside it: its span covers them, until Core's
  // spans are declared (step 4.1) and site.ts leaves capxul/declared-steps's unmigrated list.
  /** The company's name, as its site is made with it; its handle when it has none. */
  const nameOf = (handle: string) =>
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const name = yield* sql<{ readonly name: string }>`select name from app.companies where org = ${org}`;
      return Option.getOrElse(
        Option.map(Arr.head(name), (row) => row.name),
        () => handle,
      );
    });

  /**
   * Counts the restart, then removes the lost site and makes it again under its label; it is then told everything
   * again. The restart is counted first, in a transaction of its own, so a remake that keeps failing is tried once, not
   * on every reconcile: the next one finds the restart counted and stops the site (`afterFailure`).
   */
  const makeAgain = (site: string, handle: string) =>
    Effect.gen(function* () {
      const door = yield* SiteDoor;
      const sql = yield* PgClient.PgClient;
      yield* sql.withTransaction(
        sql`update app.organizations set site_restarts = site_restarts + 1 where org = ${org}`,
      );
      yield* door.remove(site).pipe(
        Effect.catchIf(
          (error) => error.code === NOT_IN_WORLD,
          () => Effect.void,
        ),
      );
      const made = yield* door.make(labelOf(handle), yield* nameOf(handle));
      yield* Effect.logWarning(`the site ${site} was lost to the site door, so it is made again as ${made.site}`);
      yield* sql.withTransaction(
        Effect.all([
          // A new site has been told nothing: it is handed every delivery again, in order.
          sql`update app.site_deliveries set delivered = false where org = ${org}`,
          Store.setSite(org, made.site, "creating"),
        ]),
      );
    });

  const sql = yield* PgClient.PgClient;
  const door = yield* SiteDoor;
  const found = yield* Store.byOrg(org);
  if (Option.isNone(found)) return yield* Effect.void;
  const organization = found.value;
  if (organization.site === null) return yield* startSite(org, organization.handle, yield* nameOf(organization.handle));
  const site = organization.site;
  const state = yield* door.site(site).pipe(
    Effect.map((each) => each.state),
    Effect.catch((error) => Effect.succeed(error.code === NOT_IN_WORLD ? LOST : UNREACHABLE)),
  );
  if (state === UNREACHABLE) return yield* Effect.void;
  if (state === "failed" || state === "interrupted" || state === LOST) {
    return yield* afterFailure(state, organization.siteRestarts) === "again"
      ? makeAgain(site, organization.handle).pipe(Effect.option, Effect.asVoid)
      : sql.withTransaction(Store.setSite(org, site, "stopped"));
  }
  if (state !== "ready") return yield* Effect.void;
  const pending = yield* sql<Pending>`
    select id, kind, body from app.site_deliveries where org = ${org} and not delivered order by id`;
  const delivered = yield* deliverInOrder(site, pending);
  const left = pending.length - delivered;
  yield* sql.withTransaction(
    Store.setSite(org, site, left === 0 && organization.setup === "ready" ? "ready" : "creating"),
  );
  return yield* Effect.void;
});

/** The world's clock, set on the bench as it is now: a frozen clock at its instant, a running one by its offset. */
const benchClock = Effect.gen(function* () {
  const door = yield* SiteDoor;
  const clock = yield* WorldClock;
  const now = yield* clock.now;
  const host = yield* Clock.currentTimeMillis;
  return yield* door.clock(now.mode === "frozen" ? { frozen_at_ms: now.nowMs } : { offset_ms: now.nowMs - host });
});

/** Hands the site each delivery in order and answers how many it took; the first it does not take stops the rest. */
const deliverInOrder = (site: string, pending: ReadonlyArray<Pending>) =>
  Effect.gen(function* () {
    const door = yield* SiteDoor;
    const sql = yield* PgClient.PgClient;
    let taken = 0;
    for (const each of pending) {
      const sent =
        each.kind === "clock"
          ? benchClock
          : door.call(site, { method: "POST", path: METHOD[each.kind], body: each.body });
      const answer = yield* Effect.option(sent);
      if (Option.isNone(answer) || answer.value.status !== 200) {
        yield* Effect.logWarning(`the site ${site} did not take ${each.kind} ${each.id}`);
        return taken;
      }
      yield* sql`update app.site_deliveries set delivered = true where id = ${each.id}`;
      taken += 1;
    }
    return taken;
  });

/** The world's companies, each site moved on first: what world.show lists. */
export const companiesOf = Effect.fn("site.companies")(function* () {
  const sql = yield* PgClient.PgClient;
  const waiting = yield* sql<{ readonly org: string }>`
    select org from app.companies where site_state <> 'ready' order by position`;
  yield* Effect.forEach(waiting, (row) => reconcile(row.org), { discard: true });
  const rows = yield* sql<{
    readonly org: string;
    readonly handle: string;
    readonly name: string;
    readonly site_state: "creating" | "ready" | "stopped";
    readonly site_url: string | null;
  }>`select org, handle, name, site_state, site_url from app.companies order by position`;
  return Arr.map(rows, (row): typeof Values.Company.Type => ({
    org: row.org,
    handle: row.handle,
    name: row.name,
    site: { state: row.site_state, url: row.site_url },
  }));
});
