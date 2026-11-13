// A company's site on the world's bench, through Core's SiteDoor. org.create starts making it; the site must then be
// told what the chain says: its company and Safe, each hat a person of the world wears (which gives them a user and
// its roles, packages/frappe-app capxul/hats.py), and the founder's capital (capxul/capital.py). Those are queued
// with the change that causes them (`app.site_deliveries`) and handed to the site, in order, once it is ready. A site
// is ready for the world (`app.companies.site_state`) when the door has made it, the setup has landed and the site
// has taken every delivery queued so far.
//
// Nothing runs in the background of a Worker: `reconcile` moves a company's site on, and is run after the setup or a
// grant lands and whenever the world's companies are read (`companiesOf`, for world.show).
import type { Values } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Str from "effect/String";
import * as PgClient from "@effect/sql-pg/PgClient";
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
  yield* sql`insert into app.site_deliveries ${sql.insert({ org, kind, body: sql.json({ ...body, org }) })}`;
});

interface Pending {
  readonly id: string;
  readonly kind: DeliveryKind;
  readonly body: unknown;
}

/**
 * Moves one company's site on: makes it if it was never started, reads its state from the door, and once the door
 * has made it, hands it every delivery still queued, in order, stopping at the first it does not take. The world
 * sees the site ready only when nothing is left to deliver and the setup has landed.
 */
export const reconcile = Effect.fn("site.reconcile")(function* (org: string) {
  const sql = yield* PgClient.PgClient;
  const door = yield* SiteDoor;
  const found = yield* Store.byOrg(org);
  if (Option.isNone(found)) return yield* Effect.void;
  const organization = found.value;
  if (organization.site === null) {
    const name = yield* sql<{ readonly name: string }>`select name from app.companies where org = ${org}`;
    return yield* startSite(
      org,
      organization.handle,
      Option.getOrElse(
        Option.map(Arr.head(name), (row) => row.name),
        () => organization.handle,
      ),
    );
  }
  const site = organization.site;
  const state = yield* door.site(site).pipe(Effect.option);
  if (Option.isNone(state)) return yield* Effect.void;
  if (state.value.state === "failed") return yield* sql.withTransaction(Store.setSite(org, site, "stopped"));
  if (state.value.state !== "ready") return yield* Effect.void;
  const pending = yield* sql<Pending>`
    select id, kind, body from app.site_deliveries where org = ${org} and not delivered order by id`;
  const delivered = yield* deliverInOrder(site, pending);
  const left = pending.length - delivered;
  yield* sql.withTransaction(
    Store.setSite(org, site, left === 0 && organization.setup === "ready" ? "ready" : "creating"),
  );
  return yield* Effect.void;
});

/** Hands the site each delivery in order and answers how many it took; the first it does not take stops the rest. */
const deliverInOrder = (site: string, pending: ReadonlyArray<Pending>) =>
  Effect.gen(function* () {
    const door = yield* SiteDoor;
    const sql = yield* PgClient.PgClient;
    let taken = 0;
    for (const each of pending) {
      const answer = yield* door
        .call(site, { method: "POST", path: METHOD[each.kind], body: each.body })
        .pipe(Effect.option);
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
