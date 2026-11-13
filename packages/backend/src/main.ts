import { createProvisioningHandler } from "@capxul/site-service";
import { required, settings } from "./platform/config.ts";
import type pg from "pg";
import { accessRoutes } from "./access/mount.ts";
import { worldNow } from "./devnet/door.ts";
import { createCore } from "./server.ts";

/** The devnet sink's psql-shaped protocol: one JSON object per row, across every statement of the text. */
const rows = (result: pg.QueryResult | pg.QueryResult[]) =>
  (Array.isArray(result) ? result : [result]).flatMap((part) => part.rows.map((row) => Object.values(row)[0] as Record<string, unknown>));

const config = settings();
const provision = createProvisioningHandler({
  publicOrigin: config.url, rpcUrl: config.rpc, coreUrl: `http://127.0.0.1:${config.port}`,
  coreSecret: config.secret, siteServiceUrl: required("SITE_SERVICE_URL"), siteServiceToken: required("SITE_SERVICE_TOKEN"),
});
// ACCESS_MAIL names the sign-in Mail. Only the world's durable devnet sink is wired today; without it Core mounts no Access routes.
const accessMail = process.env.ACCESS_MAIL;
if (accessMail !== undefined && accessMail !== "devnet-sink") throw new Error("ACCESS_MAIL supports only devnet-sink");
const devnet = accessMail ? await import("../../devnet/src/devnet/door.ts") : undefined;
const core = createCore(config, provision, (db) => {
  if (!devnet) return [];
  const worker = async <T>(run: (sql: pg.PoolClient) => Promise<T>) => {
    const client = await db.worker.connect();
    try { return await run(client); } finally { client.release(); }
  };
  const mail = devnet.devnetMail((text) => worker(async (sql) => rows(await sql.query(text))), () => worker(worldNow));
  return accessRoutes({ mail, secret: config.secret, coreUrl: config.url, rpc: config.rpc,
    deploymentFile: required("DEPLOYMENT_FILE"), namespace: required("ACCESS_SAFE_NAMESPACE") });
});
await core.start();
console.log("Core listening with durable Postgres app state and Ponder facts");
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void core.stop().then(() => process.exit(0)); });
