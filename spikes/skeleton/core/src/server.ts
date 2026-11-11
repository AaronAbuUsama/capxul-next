// The Core stub service on CORE_PORT. Plain node:http.
import { createServer } from "node:http";
import { approvalUrl, approvePage, external, getApproval, prepare, sign } from "./approvals.ts";
import { config } from "./config.ts";
import { verify } from "./hmac.ts";
import { html, readBody, send, type Ctx } from "./http.ts";
import { handleOauth } from "./oauth.ts";
import { ensureOrg, getOrg, redeliver, release, resend, status, tick } from "./outbox.ts";
import { orgId } from "./chain.ts";
import { poll } from "./watcher.ts";

const log = (m: string) => console.log(`${new Date().toISOString()} [core] ${m}`);

// Calls from Frappe and from our own CLI are signed with the shared secret.
const signed = (c: Ctx): boolean => verify(c.body, c.req.headers["x-capxul-signature"] as string | undefined);

async function route(c: Ctx): Promise<void> {
  const { req, res, url } = c;
  const m = req.method, p = url.pathname;
  const tr = req.headers["x-capxul-trace"];
  if (tr && p !== "/health") log(`trace ${tr} ${m} ${p}`);   // so Core's log can be joined to the command that made the call
  if (p === "/health") return send(res, 200, { ok: true, standIn: true });
  if (await handleOauth(c)) return;

  const approve = /^\/approve\/(apr_[0-9a-f]+)(\/sign)?$/.exec(p);
  if (approve) {
    const a = getApproval(approve[1]!);
    if (!a) return send(res, 404, { error: "unknown approval" });
    if (m === "POST" && approve[2]) {
      const done = await sign(a.id);
      return (req.headers.accept ?? "").includes("json") ? send(res, 200, done) : html(res, 200, approvePage(done!));
    }
    if (m === "GET" && !approve[2]) return (req.headers.accept ?? "").includes("json") ? send(res, 200, a) : html(res, 200, approvePage(a));
    return send(res, 405, { error: "method not allowed" });
  }

  const ext = /^\/approve\/(apr_[0-9a-f]+)\/external$/.exec(p);
  if (ext && m === "POST") {
    if (!signed(c)) return send(res, 401, { error: "bad signature" });
    const a = await external(ext[1]!, JSON.parse(c.body || "{}"));
    return typeof a === "string" ? send(res, 400, { error: a }) : send(res, 200, a);
  }
  if (m === "POST" && p.startsWith("/admin/") || p === "/prepare") {
    if (m !== "POST") return send(res, 405, { error: "method not allowed" });
    if (!signed(c)) return send(res, 401, { error: "bad signature" });
    const b = JSON.parse(c.body || "{}");
    if (p === "/prepare") {
      const a = prepare(b, typeof tr === "string" ? tr : undefined);
      return typeof a === "string" ? send(res, 400, { error: a })
        : send(res, 200, { approval_id: a.id, approval_url: approvalUrl(a) });
    }
    if (p === "/admin/org") { // the CLI tells us about an org it just created on the chain
      const o = ensureOrg(b.slug, orgId(b.slug), { name: b.name, safe: b.safe, adminEmail: b.adminEmail });
      return send(res, 200, { ok: true, released: o.released });
    }
    if (!getOrg(b.slug)) return send(res, 404, { error: `unknown org ${b.slug}` });
    if (p === "/admin/org-info") { const o = getOrg(b.slug)!; return send(res, 200, { slug: o.slug, name: o.name, safe: o.safe, adminEmail: o.adminEmail, released: o.released }); }
    if (p === "/admin/release") { release(b.slug); void tick(); return send(res, 200, { ok: true }); }
    if (p === "/admin/status") return send(res, 200, status(b.slug));
    if (p === "/admin/redeliver") { const ok = redeliver(b.slug, Number(b.seq)); if (ok) await tick(); return send(res, ok ? 200 : 404, { ok }); }
    if (p === "/admin/resend") { resend(b.slug); await poll(); await tick(); return send(res, 200, status(b.slug)); }
  }
  send(res, 404, { error: "not found" });
}

export function serve(): void {
  const server = createServer(async (req, res) => {
    try {
      const body = await readBody(req);
      await route({ req, res, url: new URL(req.url ?? "/", "http://x"), body });
    } catch (e) {
      log(`ERROR ${req.method} ${req.url}: ${(e as Error).stack}`);
      if (!res.headersSent) send(res, 500, { error: (e as Error).message });
    }
  });
  server.listen(config.corePort, "0.0.0.0", () => log(`Core stub (STAND-IN) listening on :${config.corePort}, chain ${config.rpcUrl}, Frappe ${config.frappeUrl}`));
  const loop = async () => {
    try { await poll(); await tick(); } catch (e) { log(`ERROR loop: ${(e as Error).message}`); }
    setTimeout(loop, config.pollMs);
  };
  void loop();
}
