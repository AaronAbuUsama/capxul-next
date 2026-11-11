// The Worker in front of the boxes (packages/sandbox/README.md). Every request needs `Authorization: Bearer <BOX_KEY>`.
// One Durable Object per box, named by the box; one Registry object lists the live ones.
//
//   POST /box/<name>/start {owner, ttlMs}   start its container (no internet), or find it; waits until its server answers
//   POST /box/<name>/stop                   destroy it
//   *    /box/<name>/<path>                 forwarded to the box's server (src/bin/box.ts): /info, /call, /exec, /blob
//   GET  /boxes                             every registered box, with whether it is running
//
// The runaway guard lives here, so it holds when the machine that made a box is gone: each box has an alarm at its
// expiry that destroys it, an idle box stops after IDLE_MS, and the account runs at most `max_instances` at once.
import { DurableObject } from "cloudflare:workers";

interface Env { BOX: DurableObjectNamespace<Box>; REGISTRY: DurableObjectNamespace<Registry>; BOX_KEY: string }
interface Record { name: string; owner: string; startedAt: string; expiresAt: string }

const PORT = 8080;
const IDLE_MS = 30 * 60 * 1000;
const MAX_TTL_MS = 6 * 60 * 60 * 1000;
/** 4 vCPU, 12 GiB, 20 GB: the repository's tests and TypeScript builds run here. */
const INSTANCE = "standard-4";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Registry extends DurableObject<Env> {
	async put(r: Record): Promise<void> { await this.ctx.storage.put(`box:${r.name}`, r); }
	async drop(name: string): Promise<void> { await this.ctx.storage.delete(`box:${name}`); }
	async all(): Promise<Record[]> { return [...(await this.ctx.storage.list<Record>({ prefix: "box:" })).values()]; }
}

export class Box extends DurableObject<Env> {
	private c(): Container {
		if (!this.ctx.container) throw new Error("this Durable Object has no container");
		return this.ctx.container;
	}
	private registry() { return this.env.REGISTRY.getByName("all"); }
	private async answers(): Promise<boolean> {
		try { return (await this.c().getTcpPort(PORT).fetch("http://box/info")).ok; } catch { return false; }
	}

	async start(name: string, owner: string, ttlMs: number): Promise<Response> {
		const c = this.c(), now = Date.now(), ttl = Math.min(Math.max(ttlMs || 0, 60_000), MAX_TTL_MS);
		const was = await this.ctx.storage.get<Record>("record");
		const record: Record = was && c.running ? { ...was, owner, expiresAt: new Date(now + ttl).toISOString() } : { name, owner, startedAt: new Date(now).toISOString(), expiresAt: new Date(now + ttl).toISOString() };
		if (!c.running) c.start({ image: c.images.box, enableInternet: false, instance: INSTANCE });
		await c.setInactivityTimeout(IDLE_MS);
		await this.ctx.storage.put("record", record);
		await this.ctx.storage.setAlarm(Date.parse(record.expiresAt));
		await this.registry().put(record);
		for (const end = Date.now() + 120_000; Date.now() < end; await sleep(500)) if (await this.answers()) return Response.json({ ok: true, ...record });
		return Response.json({ ok: false, error: "the box's server did not answer within 120 s" }, { status: 503 });
	}

	async stop(): Promise<Response> {
		const record = await this.ctx.storage.get<Record>("record");
		if (this.c().running) await this.c().destroy();
		await this.ctx.storage.deleteAll();
		if (record) await this.registry().drop(record.name);
		return Response.json({ ok: true });
	}

	/** The expiry: the box is destroyed whatever it is doing. */
	override async alarm(): Promise<void> { await this.stop(); }

	async running(): Promise<boolean> { return this.c().running; }

	async forward(path: string, request: Request): Promise<Response> {
		const c = this.c();
		if (!c.running) return Response.json({ error: "the box is not running: POST /start first" }, { status: 409 });
		await c.setInactivityTimeout(IDLE_MS);
		// The key stops here: the box's own server never sees it.
		const headers = new Headers(request.headers);
		headers.delete("authorization");
		return c.getTcpPort(PORT).fetch(new Request(`http://box${path}`, { method: request.method, headers, body: request.body }));
	}
}

/** Compares the presented key with BOX_KEY in constant time (over their SHA-256, so lengths do not leak either). */
const keyed = async (request: Request, key: string): Promise<boolean> => {
	if (!key) return false;
	const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
	const [a, b] = await Promise.all([digest(request.headers.get("authorization") ?? ""), digest(`Bearer ${key}`)]);
	return crypto.subtle.timingSafeEqual(a, b);
};

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (!(await keyed(request, env.BOX_KEY))) return new Response("Unauthorized", { status: 401 });
		const url = new URL(request.url);
		try {
			if (request.method === "GET" && url.pathname === "/boxes") {
				const boxes = await Promise.all((await env.REGISTRY.getByName("all").all()).map(async (r) => ({ ...r, running: await env.BOX.getByName(r.name).running() })));
				return Response.json({ boxes });
			}
			const m = /^\/box\/([a-z0-9-]{1,50})(\/.*)$/.exec(url.pathname);
			if (!m) return new Response("not a route: GET /boxes, /box/<name>/start | /stop | /<path of the box's server>", { status: 404 });
			const name = m[1]!, box = env.BOX.getByName(name), path = m[2]!;
			if (request.method === "POST" && path === "/start") {
				const o = (await request.json().catch(() => ({}))) as { owner?: string; ttlMs?: number };
				return await box.start(name, String(o.owner ?? "unknown").slice(0, 80), Number(o.ttlMs ?? 0));
			}
			if (request.method === "POST" && path === "/stop") return await box.stop();
			return await box.forward(`${path}${url.search}`, request);
		} catch (e) {
			return Response.json({ error: String(e) }, { status: 500 });
		}
	},
} satisfies ExportedHandler<Env>;
