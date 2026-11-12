import { io, type Socket } from "socket.io-client";
import { prepare, type Prepare } from "../approvals/door.ts";
import type { Database } from "../platform/db.ts";
import { signature } from "./door.ts";

type Site = { org_id: string; site: string };
type Options = { frappe: string; socket: string; secret: string; url: string; running: () => boolean };
export class RequestCollector {
  private listeners = new Map<string, { socket?: Socket; retry?: ReturnType<typeof setTimeout>; dirty: boolean; work?: Promise<void> }>();
  private db: Database;
  private options: Options;
  constructor(db: Database, options: Options) { this.db = db; this.options = options; }
  private async call(site: Site, method: string, data: unknown, trace = "") {
    const raw = JSON.stringify(data);
    const res = await fetch(`${this.options.frappe}/api/method/capxul.api.${method}`, {
      method: "POST", body: raw, signal: AbortSignal.timeout(8000),
      headers: { "content-type": "application/json", "x-capxul-signature": signature(raw, this.options.secret), "x-frappe-site-name": site.site, "x-capxul-trace": trace },
    });
    const body = await res.json() as { message?: any };
    if (!res.ok || !body.message) throw new Error(`site ${method} refused (HTTP ${res.status})`);
    return body.message;
  }
  async collect(site: Site) {
    const lock = await this.db.worker.connect();
    const key = `site-collector:${site.org_id}`;
    try {
      if (!(await lock.query("select pg_try_advisory_lock(hashtextextended($1,0)) as locked", [key])).rows[0].locked) return;
      while (this.options.running()) {
        const after = Number((await this.db.worker.query("select request_cursor from app.organizations where org_id=$1", [site.org_id])).rows[0].request_cursor);
        const page = await this.call(site, "collect_payment_requests", { org: site.org_id, after, limit: 100 });
        if (!Array.isArray(page.requests)) throw new Error("invalid site request page");
        let cursor = after;
        for (const request of page.requests) {
          if (!this.options.running()) return;
          if (!Number.isSafeInteger(request.cursor) || request.cursor <= cursor || request.org !== site.org_id || request.site !== site.site) throw new Error("invalid site request cursor or company");
          const body: Prepare = {
            request_id: request.request_id, org: request.org, site: request.site, doctype: request.doctype,
            name: request.name, document_hash: request.document_hash, requested_by: request.requested_by,
            to_party: request.to_party, to_address: request.to_address, amount: request.amount, asset: request.asset,
            ...(request.department ? { department: request.department } : {}),
          };
          const trace = String(request.trace_id ?? "");
          const saved = await this.db.transaction(site.org_id, async (sql) => {
            const old = (await sql.query("select answer,request=$3::jsonb as same from app.site_request_answers where org_id=$1 and request_id=$2", [site.org_id, body.request_id, body])).rows[0];
            if (old) {
              if (!old.same) throw new Error("IDEMPOTENCY_CONFLICT: site request changed after its first answer");
              return old.answer;
            }
            await sql.query("savepoint prepare_request");
            let answer;
            try {
              const a = await prepare(sql, body, trace);
              answer = { org: site.org_id, request_id: body.request_id, approval_id: a.id, requested_by: a.requested_by };
            } catch (error) {
              await sql.query("rollback to savepoint prepare_request");
              const message = (error as Error).message;
              const code = message.split(":")[0]!;
              if (!["INVALID_INPUT", "FORBIDDEN", "IDEMPOTENCY_CONFLICT"].includes(code)) throw error;
              answer = { org: site.org_id, request_id: body.request_id, error: { code, message } };
            }
            await sql.query("insert into app.site_request_answers (org_id,request_id,request,answer) values ($1,$2,$3,$4)", [site.org_id, body.request_id, body, answer]);
            return answer;
          }, true);
          // The answer/approval is committed before calling the site. A lost ACK repeats precisely that answer.
          // The gateway origin belongs to the running world, not the copied approval's identity.
          const answer = saved.approval_id ? { ...saved, approval_url: `${this.options.url}/approve/${saved.approval_id}` } : saved;
          const ack = await this.call(site, "answer_payment_request", answer, trace);
          if (ack.request_id !== body.request_id || typeof ack.status !== "string" || typeof ack.duplicate !== "boolean") throw new Error("site did not acknowledge request answer");
          await this.db.worker.query("update app.organizations set request_cursor=$2,collected_at=now(),collector_error=null where org_id=$1", [site.org_id, request.cursor]);
          cursor = request.cursor;
        }
        if (page.requests.length < 100) return;
      }
    } finally {
      await lock.query("select pg_advisory_unlock(hashtextextended($1,0))", [key]);
      lock.release();
    }
  }
  connect(site: Site) {
    if (this.listeners.has(site.org_id) || !this.options.running()) return;
    const listener: { socket?: Socket; retry?: ReturnType<typeof setTimeout>; dirty: boolean; work?: Promise<void> } = { dirty: false };
    this.listeners.set(site.org_id, listener);
    const reconnect = () => {
      listener.socket?.removeAllListeners(); listener.socket?.disconnect();
      if (this.options.running() && !listener.retry) listener.retry = setTimeout(() => { listener.retry = undefined; startConnect(); }, 1000);
    };
    const catchUp = () => {
      listener.dirty = true;
      if (listener.work) return;
      listener.work = (async () => {
        while (listener.dirty && this.options.running()) { listener.dirty = false; await this.collect(site); }
      })().catch(async (error) => {
        await this.db.worker.query("update app.organizations set collector_error=$2 where org_id=$1", [site.org_id, String(error.message).slice(0, 400)]);
        reconnect();
      }).finally(() => { listener.work = undefined; });
    };
    const connect = async () => {
      try {
        const token = await this.call(site, "payment_request_listener", { org: site.org_id });
        if (!this.options.running()) return;
        if (token.namespace !== `/${site.site}` || token.event !== "capxul_payment_request" || !String(token.authorization).startsWith("CapxulListener ")) throw new Error("invalid listener authorization scope");
        const socket = io(`${this.options.socket}${token.namespace}`, { reconnection: false, forceNew: true,
          extraHeaders: { Authorization: token.authorization, "X-Frappe-Site-Name": site.site, Host: site.site, Origin: new URL(this.options.frappe).protocol + "//" + site.site } });
        listener.socket = socket;
        socket.on("connect", catchUp);
        socket.on(token.event, (hint: any) => { if (hint.org === site.org_id) catchUp(); });
        socket.on("disconnect", reconnect); socket.on("connect_error", reconnect);
      } catch (error) {
        console.error(`Core site listener ${site.org_id}: ${(error as Error).message}`);
        reconnect();
      }
    };
    // Track the authorization request as work too, so snapshot pause drains it before returning.
    const startConnect = () => { listener.work = connect().finally(() => { listener.work = undefined; if (listener.dirty) catchUp(); }); };
    startConnect();
  }
  async pause() {
    for (const listener of this.listeners.values()) { clearTimeout(listener.retry); listener.socket?.removeAllListeners(); listener.socket?.disconnect(); }
    await Promise.all([...this.listeners.values()].map((l) => l.work));
    this.listeners.clear();
  }
}
