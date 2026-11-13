import { createProvisioningHandler } from "@capxul/site-service";
import pg from "pg";
import { devnetMail } from "../../devnet/src/devnet/door.ts";
import { worldNow } from "./devnet/door.ts";
import { required, settings } from "./platform/config.ts";
import { createCore } from "./server.ts";

const config = settings();
const provision = createProvisioningHandler({
  publicOrigin: config.url, rpcUrl: config.rpc, coreUrl: `http://127.0.0.1:${config.port}`,
  coreSecret: config.secret, siteServiceUrl: required("SITE_SERVICE_URL"), siteServiceToken: required("SITE_SERVICE_TOKEN"),
});

// The world's config chooses the Mail sink and supplies the email links. Only the fresh local world's durable devnet sink
// exists today; without it, or without every link, Core sends no notices rather than guessing a provider or a link.
const sink = process.env.CAPXUL_MAIL_SINK;
if (sink !== undefined && sink !== "devnet") throw new Error("CAPXUL_MAIL_SINK must be devnet or unset");
let links: Record<string, unknown> | null = null;
try { links = JSON.parse(process.env.CAPXUL_NOTICE_LINKS ?? "null"); } catch { links = null; }
const linkKeys = ["quickstart", "chat", "support", "signup", "explorer"] as const;
const linked = !!links && linkKeys.every((key) => typeof links![key] === "string" && (links![key] as string).trim() !== "");
const mailPool = sink === "devnet" && linked ? new pg.Pool({ connectionString: config.workerDatabase }) : undefined;
if (sink === "devnet" && !linked) console.error("Notices off: CAPXUL_NOTICE_LINKS must set quickstart, chat, support, signup and explorer");
const notices = mailPool && links ? {
  mail: devnetMail(async (text) => {
    const results = await mailPool.query(text) as unknown as { rows: { jsonb_build_object: Record<string, unknown> }[] } | { rows: { jsonb_build_object: Record<string, unknown> }[] }[];
    return (Array.isArray(results) ? results : [results]).flatMap((r) => r.rows.map((row) => row.jsonb_build_object));
  }, () => worldNow(mailPool)),
  links: { quickstart: links.quickstart as string, chat: links.chat as string, support: links.support as string, signup: links.signup as string,
    explorer: (address: string) => `${links!.explorer as string}${address}` },
} : undefined;

const core = createCore(config, provision, notices);
await core.start();
console.log("Core listening with durable Postgres app state and Ponder facts");
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void core.stop().then(() => mailPool?.end()).then(() => process.exit(0)); });
