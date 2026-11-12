import { createSiteService } from "./sites/door.ts";

const required = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
};
const command: unknown = JSON.parse(required("BENCH_COMMAND_JSON"));
if (!Array.isArray(command) || !command.length || command.some((arg) => typeof arg !== "string")) throw new Error("BENCH_COMMAND_JSON must be an argv array");
const service = createSiteService({
  command, token: required("SITE_SERVICE_TOKEN"), secret: required("CAPXUL_SECRET"), stateDir: required("SITE_SERVICE_STATE_DIR"),
  world: required("CAPXUL_WORLD"), baseDomain: required("SITE_BASE_DOMAIN"),
  dbRootPassword: required("BENCH_DB_ROOT_PASSWORD"), adminPassword: required("CAPXUL_ADMIN_PASSWORD"),
  siteScheme: process.env.SITE_SCHEME === "http" ? "http" : "https",
  ...(process.env.SITE_PORT ? { sitePort: Number(process.env.SITE_PORT) } : {}),
});
service.listen(Number(process.env.PORT ?? 8788), "127.0.0.1", () => console.log("site-service listening on loopback"));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  // Stop ingress, but let active responses and bench subprocesses finish naturally.
  process.on(signal, () => service.close(() => { process.exitCode = 0; }));
}
