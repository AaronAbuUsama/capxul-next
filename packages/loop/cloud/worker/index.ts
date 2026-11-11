// The Worker in front of the boxes (packages/loop/cloud/README.md). Every request needs `Authorization: Bearer <BOX_KEY>`;
// the key is a Worker secret and, on the Mac, var/cloud/box.json. One Durable Object per box, named by the run.
//
//   POST /box/<name>/start   start the box's container (no internet) or find it running; waits until its server answers
//   POST /box/<name>/stop    destroy it
//   *    /box/<name>/<path>  forwarded to the box's server (src/bin/box.ts): /info, /call, /exec, /blob
import { DurableObject } from "cloudflare:workers";

interface Env { BOX: DurableObjectNamespace<Box>; BOX_KEY: string }

const PORT = 8080;
/** A box nobody calls for this long is stopped by Cloudflare: a run that died leaves nothing running for long. */
const IDLE_MS = 2 * 60 * 60 * 1000;
/** 4 vCPU, 12 GiB, 20 GB: the repository's tests and the TypeScript builds run here. */
const INSTANCE = "standard-4";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Box extends DurableObject<Env> {
	private c(): Container {
		if (!this.ctx.container) throw new Error("this Durable Object has no container");
		return this.ctx.container;
	}
	private async answers(): Promise<boolean> {
		try { return (await this.c().getTcpPort(PORT).fetch("http://box/info")).ok; } catch { return false; }
	}

	async start(): Promise<Response> {
		const c = this.c();
		if (!c.running) c.start({ image: c.images.box, enableInternet: false, instance: INSTANCE });
		await c.setInactivityTimeout(IDLE_MS);
		for (const end = Date.now() + 90_000; Date.now() < end; await sleep(500)) if (await this.answers()) return Response.json({ ok: true });
		return Response.json({ ok: false, error: "the box's server did not answer within 90 s" }, { status: 503 });
	}

	async stop(): Promise<Response> {
		if (this.c().running) await this.c().destroy();
		return Response.json({ ok: true });
	}

	async forward(path: string, request: Request): Promise<Response> {
		const c = this.c();
		if (!c.running) return Response.json({ error: "the box is not running: POST /start first" }, { status: 409 });
		await c.setInactivityTimeout(IDLE_MS);
		return c.getTcpPort(PORT).fetch(new Request(`http://box${path}`, request));
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (!env.BOX_KEY || request.headers.get("authorization") !== `Bearer ${env.BOX_KEY}`) return new Response("Unauthorized", { status: 401 });
		const url = new URL(request.url), m = /^\/box\/([a-z0-9-]{1,63})(\/.*)$/.exec(url.pathname);
		if (!m) return new Response("not a route: /box/<name>/start | /stop | /<path of the box's server>", { status: 404 });
		const box = env.BOX.getByName(m[1]!), path = m[2]!;
		try {
			if (request.method === "POST" && path === "/start") return await box.start();
			if (request.method === "POST" && path === "/stop") return await box.stop();
			return await box.forward(`${path}${url.search}`, request);
		} catch (e) {
			return Response.json({ error: String(e) }, { status: 500 });
		}
	},
} satisfies ExportedHandler<Env>;
