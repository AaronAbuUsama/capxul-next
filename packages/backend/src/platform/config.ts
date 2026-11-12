export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; Core has no JSON runtime or admin-role fallback`);
  return value;
}
export function settings() {
  return {
    database: required("DATABASE_URL"), workerDatabase: required("WORKER_DATABASE_URL"),
    secret: required("CAPXUL_SECRET"), port: Number(process.env.CORE_PORT ?? 8787), host: process.env.CORE_HOST ?? "127.0.0.1",
    url: process.env.CORE_URL ?? "http://127.0.0.1:8787", frappe: process.env.FRAPPE_URL ?? "http://127.0.0.1:8000",
    ponder: process.env.PONDER_URL ?? "http://127.0.0.1:42069", rpc: required("RPC_URL"), chainId: Number(process.env.CHAIN_ID ?? 84532),
    socket: process.env.FRAPPE_SOCKET_URL ?? "http://127.0.0.1:9000",
    startPaused: process.env.CORE_START_PAUSED === "true",
    finality: Number(required("FINALITY_DEPTH")), world: process.env.CAPXUL_WORLD ?? "main",
  };
}
