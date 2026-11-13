import { Effect } from "effect";
import { createProvisioningHandler } from "@capxul/site-service";
import { authenticate } from "./access/door.ts";
import { worldNow } from "./devnet/door.ts";
import { requireSeat } from "./organizations/door.ts";
import { required, settings } from "./platform/config.ts";
import type { Database } from "./platform/db.ts";
import { createCore } from "./server.ts";

const config = settings();
/** sites.provision-principal: Access authenticates the Bearer on the world clock, then Organizations requires a current
 * Seat, on one checked-out Sql. The founder-of-deployed-setup branch joins once Organizations publishes readSetupFounder. */
const authorizeProvisioning = (db: Database) => ({ orgId, bearer }: { orgId: string; bearer: string }) => Effect.tryPromise({
  try: () => db.transaction("", async (sql) => {
    const principal = await authenticate(sql, bearer, await worldNow(sql));
    await requireSeat(sql, orgId, { principalId: principal.personId, kind: principal.kind === "person" ? "human" : "agent", safe: principal.safeAddress });
    return principal;
  }),
  catch: (error) => {
    const [code = "", ...rest] = String(error instanceof Error ? error.message : "").split(": ");
    return { code, message: rest.join(": ") };
  },
});
const core = createCore(config, (db) => createProvisioningHandler({
  coreUrl: `http://127.0.0.1:${config.port}`, coreSecret: config.secret,
  siteServiceUrl: required("SITE_SERVICE_URL"), siteServiceToken: required("SITE_SERVICE_TOKEN"), authorize: authorizeProvisioning(db),
}));
await core.start();
console.log("Core listening with durable Postgres app state and Ponder facts");
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void core.stop().then(() => process.exit(0)); });
