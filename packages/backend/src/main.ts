import { createProvisioningHandler } from "@capxul/site-service";
import { required, settings } from "./platform/config.ts";
import type pg from "pg";
import { accessRoutes } from "./access/mount.ts";
import { worldNow } from "./devnet/door.ts";
import { composeOrganizations } from "./organizations/compose.ts";
import { createCore } from "./server.ts";

/** The devnet sink's psql-shaped protocol: one JSON object per row, across every statement of the text. */
const rows = (result: pg.QueryResult | pg.QueryResult[]) =>
  (Array.isArray(result) ? result : [result]).flatMap((part) => part.rows.map((row) => Object.values(row)[0] as Record<string, unknown>));

const config = settings();
const provision = createProvisioningHandler({
  publicOrigin: config.url, rpcUrl: config.rpc, coreUrl: `http://127.0.0.1:${config.port}`,
  coreSecret: config.secret, siteServiceUrl: required("SITE_SERVICE_URL"), siteServiceToken: required("SITE_SERVICE_TOKEN"),
});
// CAPXUL_MAIL_SINK=devnet names the world's durable devnet Mail sink, shared with Notices. Without it Core mounts no Access routes.
const sink = process.env.CAPXUL_MAIL_SINK;
if (sink !== undefined && sink !== "devnet") throw new Error("CAPXUL_MAIL_SINK supports only devnet");
const devnet = sink ? await import("../../devnet/src/devnet/door.ts") : undefined;
// Organizations: the setups' routes and the setup runner, which ticks in Core's worker loop (organizations.setup-composition).
let organizations: ReturnType<typeof composeOrganizations> | undefined;
const orgs = (db: Parameters<typeof composeOrganizations>[0]) => organizations ??= composeOrganizations(db, config.chainId);
const core = createCore(config, provision, (db) => {
  const worker = async <T>(run: (sql: pg.PoolClient) => Promise<T>) => {
    const client = await db.worker.connect();
    try { return await run(client); } finally { client.release(); }
  };
  // Access needs the Mail sink; routes that do not are appended unconditionally.
  const access = devnet ? accessRoutes({ mail: devnet.devnetMail((text) => worker(async (sql) => rows(await sql.query(text))), () => worker(worldNow)),
    secret: config.secret, coreUrl: config.url, rpc: config.rpc,
    deploymentFile: required("DEPLOYMENT_FILE"), namespace: required("ACCESS_SAFE_NAMESPACE") }) : [];
  return [...access, ...orgs(db).routes];
}, (db) => [orgs(db).work]);
await core.start();
console.log("Core listening with durable Postgres app state and Ponder facts");
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void core.stop().then(() => process.exit(0)); });
