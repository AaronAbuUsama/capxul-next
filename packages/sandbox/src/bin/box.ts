// The server inside a box (packages/sandbox/image/Dockerfile runs it). Reads its port and its checkout from the environment.
import { serveBox } from "../modules/box/service.ts";

const machine: Record<string, string> = {};
for (const k of ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR"]) { const v = process.env[k]; if (v) machine[k] = v; }
const served = await serveBox({ port: Number(process.env.BOX_PORT ?? 8080), machine, repo: process.env.BOX_REPO ?? "/opt/capxul" });
process.stdout.write(`box listening on ${served.port}\n`);
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => { void served.close().then(() => process.exit(0)); });
