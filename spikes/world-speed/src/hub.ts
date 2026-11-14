// The hub: ONE Worker deployed once, whose Durable Object classes own the container applications of every world.
// A "world" here is only a name: the Durable Object ids `getByName(<world>)` of each class, plus a Neon branch that
// the measuring script makes. Nothing is deployed per world.
//
// Spike code (outside the ladder): plain async Workers code, so the timings are the platform's, not a library's.
//
//   POST /<token>/<kind>/<world>/start   body: { entrypoint?, env?, enableInternet?, instance? }
//        starts the container (retrying Cloudflare's "no container instance" refusals) and waits until it answers
//        its readiness probe; answers with every try and its timings
//   POST /<token>/<kind>/<world>/stop    destroys the container
//   GET  /<token>/<kind>/<world>/status  running or not, and the record of its starts
//   ANY  /<token>/<kind>/<world>/port/<path>   forwarded to the container's port as it is (JSON-RPC, /ready, /metrics)
//   POST /<token>/chain/<world>/quiet    JSON-RPC to anvil, for Ponder and alto (never starts it)
// <kind> is chain (anvil), index (Ponder) or bundler (alto).
import { DurableObject } from "cloudflare:workers";

interface Env {
  readonly HUB_TOKEN: string;
  readonly ChainBox: DurableObjectNamespace<Box>;
  readonly IndexBox: DurableObjectNamespace<Box>;
  readonly BundlerBox: DurableObjectNamespace<Box>;
}

const PORTS: Record<string, number> = { chain: 8545, index: 42069, bundler: 4337 };
/** The image key each class finds in ctx.container.images when its application uses schedulingPolicy durable_object. */
const IMAGE_KEYS: Record<string, string> = { chain: "Anvil", index: "Ponder", bundler: "Alto" };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Attempt {
  readonly at: number;
  readonly startCalled: boolean;
  readonly outcome: string;
  readonly ms: number;
}

const readiness = async (kind: string, port: Fetcher): Promise<{ ok: boolean; detail: string }> => {
  if (kind === "chain") {
    const response = await port.fetch("http://container/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    const text = await response.text();
    return { ok: response.status === 200 && text.includes("result"), detail: `${response.status} ${text.slice(0, 80)}` };
  }
  const path = kind === "index" ? "/health" : "/health";
  if (kind === "bundler") {
    const response = await port.fetch("http://container/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_supportedEntryPoints", params: [] }),
    });
    const text = await response.text();
    return { ok: response.status === 200 && text.includes("0x"), detail: `${response.status} ${text.slice(0, 80)}` };
  }
  const response = await port.fetch(`http://container${path}`);
  return { ok: response.status === 200, detail: `${response.status}` };
};

export class Box extends DurableObject<Env> {
  private kind(): string {
    return (this.ctx.storage.kv.get("kind") as string | undefined) ?? "chain";
  }

  async start(kind: string, options: {
    entrypoint?: string[];
    env?: Record<string, string>;
    enableInternet?: boolean;
    instance?: string;
    patienceMs?: number;
  }) {
    this.ctx.storage.kv.put("kind", kind);
    const container = this.ctx.container!;
    const began = Date.now();
    const attempts: Attempt[] = [];
    const patience = options.patienceMs ?? 240_000;
    const images = (() => {
      try {
        return container.images ?? {};
      } catch {
        return {};
      }
    })();
    const image = images[IMAGE_KEYS[kind] ?? ""];
    let backoff = 1000;
    let firstAnswerMs: number | null = null;
    let lastDetail = "";
    const monitorEvents: string[] = [];
    while (Date.now() - began < patience) {
      const at = Date.now();
      let startCalled = false;
      try {
        if (!container.running) {
          startCalled = true;
          const startOptions: Record<string, unknown> = {
            enableInternet: options.enableInternet ?? false,
            ...(options.entrypoint ? { entrypoint: options.entrypoint } : {}),
            ...(options.env ? { env: options.env } : {}),
            ...(image ? { image } : {}),
            ...(image ? { instance: options.instance ?? (kind === "chain" ? "lite" : "basic") } : {}),
          };
          container.start(startOptions as ContainerStartupOptions);
          container.monitor().then(
            () => monitorEvents.push(`exited at ${Date.now() - began} ms`),
            (error: unknown) => monitorEvents.push(`monitor at ${Date.now() - began} ms: ${String(error instanceof Error ? error.message : error).slice(0, 200)}`),
          );
          await container.setInactivityTimeout(3_600_000);
        }
        const ready = await readiness(kind, container.getTcpPort(PORTS[kind] ?? 8545));
        lastDetail = ready.detail;
        attempts.push({ at: at - began, startCalled, outcome: ready.ok ? "ready" : `not ready: ${ready.detail}`, ms: Date.now() - at });
        if (ready.ok) {
          firstAnswerMs = Date.now() - began;
          break;
        }
        await sleep(500);
      } catch (error) {
        const message = String(error instanceof Error ? error.message : error);
        lastDetail = message;
        const refused = /no container instance|try again later|rate limit/i.test(message);
        attempts.push({ at: at - began, startCalled, outcome: `${refused ? "refused" : "error"}: ${message.slice(0, 160)}`, ms: Date.now() - at });
        if (refused) {
          await sleep(backoff);
          backoff = Math.min(backoff * 2, 4000);
        } else {
          await sleep(500);
        }
      }
    }
    const inspected = await container.inspect?.().catch((error: unknown) => String(error));
    const record = {
      kind,
      inspected,
      native: image !== undefined,
      began: new Date(began).toISOString(),
      readyMs: firstAnswerMs,
      startCalls: attempts.filter((a) => a.startCalled).length,
      refusals: attempts.filter((a) => a.outcome.startsWith("refused")).length,
      attempts,
      lastDetail,
      monitorEvents,
    };
    const starts = (this.ctx.storage.kv.get("starts") as unknown[] | undefined) ?? [];
    this.ctx.storage.kv.put("starts", [...starts, record].slice(-10));
    return record;
  }

  async stop() {
    const container = this.ctx.container!;
    const began = Date.now();
    const was = container.running;
    if (was) await container.destroy();
    return { wasRunning: was, ms: Date.now() - began };
  }

  /** Asks the container to stop (SIGTERM), so its process can shut down cleanly; waits for it to exit. */
  async term(waitMs = 30_000) {
    const container = this.ctx.container!;
    const began = Date.now();
    if (!container.running) return { wasRunning: false, ms: 0 };
    const exited = container.monitor().then(() => "exited", (error: unknown) => `monitor: ${String(error).slice(0, 120)}`);
    container.signal(15);
    const outcome = await Promise.race([exited, sleep(waitMs).then(() => "still running")]);
    if (outcome === "still running") await container.destroy();
    return { wasRunning: true, outcome, ms: Date.now() - began };
  }

  async status() {
    return {
      running: this.ctx.container?.running ?? false,
      starts: this.ctx.storage.kv.get("starts") ?? [],
    };
  }

  /** Forwards a request to the container's port; never starts it. */
  async forward(kind: string, path: string, method: string, body: string | null, headers: Record<string, string>) {
    const container = this.ctx.container!;
    if (!container.running) return { status: 503, body: JSON.stringify({ error: "not running" }), ms: 0 };
    const began = Date.now();
    const response = await container
      .getTcpPort(PORTS[kind] ?? 8545)
      .fetch(`http://container${path}`, { method, body: method === "GET" ? undefined : body, headers });
    return { status: response.status, body: await response.text(), ms: Date.now() - began };
  }

  async forwardTo(port: number, path: string, method: string, body: string | null, headers: Record<string, string>) {
    const container = this.ctx.container!;
    if (!container.running) return { status: 503, body: "not running", ms: 0 };
    const began = Date.now();
    const response = await container.getTcpPort(port).fetch(`http://container${path}`, { method, headers });
    return { status: response.status, body: await response.text(), ms: Date.now() - began };
  }

  /** Erases this object's storage, so a world name can be used again from nothing. */
  async forget() {
    await this.stop();
    this.ctx.storage.kv.delete("starts");
    this.ctx.storage.kv.delete("kind");
    return { forgotten: true };
  }
}

export class ChainBox extends Box {}
export class IndexBox extends Box {}
export class BundlerBox extends Box {}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const [, token = "", kind = "", world = "", action = "", ...rest] = url.pathname.split("/");
    if (token !== env.HUB_TOKEN || token === "") return json({ error: "not found" }, 404);
    const namespaces: Record<string, DurableObjectNamespace<Box>> = {
      chain: env.ChainBox,
      index: env.IndexBox,
      bundler: env.BundlerBox,
    };
    const namespace = namespaces[kind];
    if (!namespace || !/^[a-z0-9-]{1,40}$/.test(world)) return json({ error: "no such kind or world" }, 404);
    // Ponder is placed next to the world's Neon branch (aws-eu-west-2): a fleet application says so with its
    // region constraint; a native one cannot, so the Durable Object that owns it is hinted to western Europe.
    const box = kind === "index" ? namespace.get(namespace.idFromName(world), { locationHint: "weur" }) : namespace.getByName(world);
    const began = Date.now();
    try {
      switch (`${request.method} ${action}`) {
        case "POST start": {
          const options = request.headers.get("content-length") === "0" ? {} : await request.json().catch(() => ({}));
          return json({ ...(await box.start(kind, options as never)), workerMs: Date.now() - began });
        }
        case "POST stop":
          return json(await box.stop());
        case "GET status":
          return json(await box.status());
        case "POST term":
          return json(await box.term());
        case "POST forget":
          return json(await box.forget());
        case "POST quiet": {
          const answer = await box.forward("chain", "/", "POST", await request.text(), { "content-type": "application/json" });
          return new Response(answer.body, { status: answer.status, headers: { "content-type": "application/json" } });
        }
        default: {
          if (action === "logs") {
            // A side port (42070) where a wrapped entrypoint serves the main process's log (measure/refusal.py).
            const answer = await box.forwardTo(42070, "/", "GET", null, {});
            return new Response(answer.body, { status: answer.status });
          }
          if (action !== "port") return json({ error: "no such route" }, 404);
          const body = request.method === "GET" ? null : await request.text();
          const answer = await box.forward(kind, `/${rest.join("/")}${url.search}`, request.method, body, {
            "content-type": request.headers.get("content-type") ?? "application/json",
          });
          return new Response(answer.body, {
            status: answer.status,
            headers: { "content-type": "application/json", "x-container-ms": String(answer.ms) },
          });
        }
      }
    } catch (error) {
      return json({ error: String(error instanceof Error ? error.message : error) }, 502);
    }
  },
};
