import { Effect } from "effect";
import { createDocumentHandler, createProvisioningHandler, DOCUMENT_PATH, PROVISION_PATH, SitesStore, type ProvisioningOptions, type SiteRequestAnswer } from "@capxul/site-service";
import { authenticate } from "../access/door.ts";
import { requireSeat } from "../organizations/door.ts";
import { createFrappeSite } from "../plugs/door.ts";
import { record, type Database, type Sql } from "../platform/door.ts";
import type { RawRoute } from "../server.ts";

/** Core's doors throw "CODE: message"; the site handlers take { code, message } and replace any code they do not declare. */
const refusal = (error: unknown) => {
  const [code = "", ...rest] = String(error instanceof Error ? error.message : "").split(": ");
  return { code, message: rest.join(": ") };
};

/** Core's Sites composition: provisioning with its durable site lifecycle, and the public document door, on Core's database.
 * Sites depends on neither the world clock's owner nor Approvals, so Core's composition injects both: `worldNow` reads the
 * world's clock on the caller's transaction, and `requestAnswer` reads the collector's saved answer for a held request. */
export function sitesRoutes(input: { world: string; frappe: string; secret: string; provisioning: Omit<ProvisioningOptions, "lifecycle">;
  worldNow: (sql: Sql) => Promise<number>;
  requestAnswer: (sql: Sql, request: { org: string; request_id: string; requested_by: string }) => Promise<SiteRequestAnswer> }) {
  const { worldNow } = input;
  const site = createFrappeSite({ baseUrl: input.frappe, secret: input.secret });
  return (db: Database): RawRoute[] => {
    const store = new SitesStore(db, record, worldNow);
    // Slice zero runs one bench per world, so the world names its bench; restore rebinds both (sites.restore-identity).
    const lifecycle = { world: input.world, bench: input.world, store,
      readSite: (call: Parameters<typeof site.readSite>[0]) => site.readSite(call).pipe(Effect.map((seen) => ({ ...seen, apps: [...seen.apps] }))) };
    return [
      { path: PROVISION_PATH, handle: createProvisioningHandler({ ...input.provisioning, lifecycle }) },
      { path: DOCUMENT_PATH, handle: createDocumentHandler({ store,
        provider: { doorCall: site.doorCall, doorReport: (call) => site.doorReport({ ...call, filters: call.filters ?? {} })
          .pipe(Effect.map((report) => ({ columns: [...report.columns], rows: [...report.rows] }))) },
        // Access authenticates the Bearer on the world clock and Organizations requires a current Seat, on one transaction.
        authorize: ({ orgId, bearer }) => Effect.tryPromise({ try: () => db.transaction("", async (sql) => {
          const principal = await authenticate(sql, bearer, await worldNow(sql));
          await requireSeat(sql, orgId, { principalId: principal.personId, kind: principal.kind === "person" ? "human" : "agent", safe: principal.safeAddress });
          return principal;
        }), catch: refusal }),
        requestAnswer: (request) => Effect.tryPromise({ try: () => db.transaction(request.org, (sql) => input.requestAnswer(sql, request)), catch: refusal }),
      }) },
    ];
  };
}
