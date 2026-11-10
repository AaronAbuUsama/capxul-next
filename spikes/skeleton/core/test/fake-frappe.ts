// A fake of capxul.api.chain_event for test-core.sh. Same rules as INTERFACE.md; state persists in a file so a
// restart keeps "what was applied". Test hooks: GET /_calls, GET /_applied, POST /_restore?org=&to= (simulate a restore).
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { verify } from "../src/hmac.ts";

const port = Number(process.env.FAKE_PORT), file = process.env.FAKE_STATE!;
type S = { last: Record<string, number>; applied: Record<string, any>; calls: any[] };
const s: S = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { last: {}, applied: {}, calls: [] };
const save = () => writeFileSync(file, JSON.stringify(s));
const reply = (res: any, code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };

createServer(async (req, res) => {
  const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString(), url = new URL(req.url!, "http://x");
  if (url.pathname === "/_calls") return reply(res, 200, s.calls);
  if (url.pathname === "/_applied") return reply(res, 200, Object.values(s.applied));
  if (url.pathname === "/_restore") {
    const org = url.searchParams.get("org")!, to = Number(url.searchParams.get("to"));
    for (const [k, e] of Object.entries<any>(s.applied)) if (e.org === org && e.seq > to) delete s.applied[k];
    s.last[org] = to; save(); return reply(res, 200, { ok: true });
  }
  if (url.pathname !== "/api/method/capxul.api.chain_event") return reply(res, 404, {});
  const sigOk = verify(raw, req.headers["x-capxul-signature"] as string);
  const call: any = { sigOk, site: req.headers["x-frappe-site-name"] };
  if (!sigOk) { s.calls.push({ ...call, status: 401 }); save(); return reply(res, 401, { exc: "bad signature" }); }
  const e = JSON.parse(raw), last = s.last[e.org] ?? 0;
  Object.assign(call, { seq: e.seq, key: e.event_key, kind: e.kind });
  let status = 200, body: any;
  if (s.applied[e.event_key]) { body = { message: { applied: false, last_seq: last } }; }
  else if (e.seq !== last + 1) { status = 409; body = { expected: last + 1 }; }
  else { s.applied[e.event_key] = { ...e, sigOk, site: call.site, times: 1 }; s.last[e.org] = e.seq; body = { message: { applied: true, last_seq: e.seq } }; }
  s.calls.push({ ...call, status }); save(); reply(res, status, body);
}).listen(port, "127.0.0.1");
