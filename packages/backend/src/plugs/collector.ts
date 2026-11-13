import { io, type Socket } from "socket.io-client";
import { Effect } from "effect";
import { prepare, type Prepare } from "../approvals/door.ts";
import { transaction, type Database } from "../platform/db.ts";
import type { WorldNow } from "./roles.ts";
import { createFrappeSite, type FrappeSite } from "./site.ts";

type Site = { org_id: string; site: string };
/** Composition supplies the world clock read in the answer's transaction; a record takes no host time. */
type Options = { frappe: string; socket: string; secret: string; url: string; running: () => boolean; worldNow: WorldNow };
type Listener = { socket?: Socket; retry?: ReturnType<typeof setTimeout> | undefined; dirty: boolean;
  work?: Promise<void> | undefined; connecting?: Promise<void> | undefined };
export class RequestCollector {
  private listeners = new Map<string, Listener>();
  private db: Database;
  private options: Options;
  private provider: FrappeSite["Service"];
  constructor(db: Database, options: Options) {
    this.db = db; this.options = options;
    this.provider = createFrappeSite({ baseUrl: options.frappe, secret: options.secret });
  }
  async collect(site: Site) {
    const lock = await this.db.worker.connect();
    const key = `site-collector:${site.org_id}`;
    try {
      if (!(await lock.query("select pg_try_advisory_lock(hashtextextended($1,0)) as locked", [key])).rows[0].locked) return;
      while (this.options.running()) {
        const after = Number((await lock.query("select request_cursor from app.organizations where org_id=$1", [site.org_id])).rows[0].request_cursor);
        const page = await Effect.runPromise(this.provider.collectPaymentRequests({ orgId: site.org_id, site: site.site, after, limit: 100 }));
        for (const request of page.requests) {
          if (!this.options.running()) return;
          const body: Prepare = {
            request_id: request.request_id, org: request.org, site: request.site, doctype: request.doctype,
            name: request.name, document_hash: request.document_hash, requested_by: request.requested_by,
            to_party: request.to_party, to_address: request.to_address, amount: request.amount, asset: request.asset,
            ...(request.department ? { department: request.department } : {}),
          };
          const trace = String(request.trace_id ?? "");
          // Reuse the lock connection: simultaneous collectors must not borrow twice from the bounded worker pool.
          const answer = await transaction(lock, site.org_id, async (sql) => {
            const old = (await sql.query("select answer,request=$3::jsonb as same from app.site_request_answers where org_id=$1 and request_id=$2", [site.org_id, body.request_id, body])).rows[0];
            if (old) {
              if (!old.same) throw new Error("IDEMPOTENCY_CONFLICT: site request changed after its first answer");
              return old.answer;
            }
            await sql.query("savepoint prepare_request");
            let answer;
            try {
              const a = await prepare(sql, body, trace, await this.options.worldNow(sql));
              answer = { org: site.org_id, request_id: body.request_id, approval_id: a.id, approval_url: `${this.options.url}/approve/${a.id}`, requested_by: a.requested_by };
            } catch (error) {
              await sql.query("rollback to savepoint prepare_request");
              const message = (error as Error).message;
              const code = message.split(":")[0]!;
              if (!["INVALID_INPUT", "FORBIDDEN", "IDEMPOTENCY_CONFLICT"].includes(code)) throw error;
              answer = { org: site.org_id, request_id: body.request_id, error: { code, message } };
            }
            await sql.query("insert into app.site_request_answers (org_id,request_id,request,answer) values ($1,$2,$3,$4)", [site.org_id, body.request_id, body, answer]);
            return answer;
          });
          // The answer/approval is committed before calling the site. A lost ACK repeats precisely that answer.
          await Effect.runPromise(this.provider.answerPaymentRequest({ ...answer, orgId: site.org_id, site: site.site, traceId: trace }));
          await lock.query("update app.organizations set request_cursor=$2,collected_at=now(),collector_error=null where org_id=$1", [site.org_id, request.cursor]);
        }
        if (page.requests.length < 100) return;
      }
    } finally {
      try { await lock.query("select pg_advisory_unlock(hashtextextended($1,0))", [key]); }
      finally { lock.release(); }
    }
  }
  connect(site: Site) {
    if (this.listeners.has(site.org_id) || !this.options.running()) return;
    const listener: Listener = { dirty: false };
    this.listeners.set(site.org_id, listener);
    const reconnect = () => {
      listener.socket?.removeAllListeners(); listener.socket?.disconnect();
      if (this.options.running() && !listener.retry) listener.retry = setTimeout(() => { listener.retry = undefined; startConnect(); }, 1000);
    };
    const catchUp = () => {
      if (!this.options.running()) return;
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
        const token = await Effect.runPromise(this.provider.paymentRequestListener({ orgId: site.org_id, site: site.site }));
        if (!this.options.running()) return;
        const socket = io(`${this.options.socket}${token.namespace}`, { reconnection: false, forceNew: true,
          extraHeaders: { Authorization: token.authorization, "X-Frappe-Site-Name": site.site, Origin: new URL(this.options.socket).origin } });
        listener.socket = socket;
        socket.on("connect", catchUp);
        socket.on(token.event, (hint: any) => { if (hint.org === site.org_id) catchUp(); });
        socket.on("disconnect", reconnect); socket.on("connect_error", reconnect);
      } catch (error) {
        console.error(`Core site listener ${site.org_id}: ${(error as Error).message}`);
        reconnect();
      }
    };
    // Reauthorization can overlap an outstanding answer; neither promise may hide the other from pause.
    const startConnect = () => {
      if (listener.connecting || !this.options.running()) return;
      listener.connecting = connect().finally(() => { listener.connecting = undefined; });
    };
    startConnect();
  }
  async pause() {
    for (const listener of this.listeners.values()) { clearTimeout(listener.retry); listener.socket?.removeAllListeners(); listener.socket?.disconnect(); }
    await Promise.all([...this.listeners.values()].flatMap((l) => [l.connecting, l.work]));
    this.listeners.clear();
  }
}
