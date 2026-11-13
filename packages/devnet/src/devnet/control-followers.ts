import type { ServerResponse } from "node:http";
import { Refusal } from "./control.ts";

/** A follower the barrier and the clock's stops wait for (devnet.time-protocol, devnet.stateful-followers). */
export type Follower = { name: string; stateful: boolean; acked: number; nextDue: number | null; stream: ServerResponse | null };

const send = (res: ServerResponse, event: object) => res.write(`data: ${JSON.stringify(event)}\n\n`);
const sse = (res: ServerResponse) => res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });

/**
 * The followers that joined over the protocol and the watchers of the clock's events. Every event a follower is sent carries a `seq`;
 * the follower acknowledges it by that `seq`. A stop, a save and a restore wait until every follower concerned has acknowledged,
 * or refuse WORK_DIED naming those that did not.
 */
export class Barrier {
  private followers = new Map<string, Follower>();
  private watchers = new Set<ServerResponse>();
  private waiters = new Set<() => void>();
  private seq = 0;

  join(name: string, stateful: boolean, clock: object) {
    if (this.followers.has(name)) throw new Refusal("WRONG_STATE", `a follower named ${name} is already following`);
    this.followers.set(name, { name, stateful, acked: this.seq, nextDue: null, stream: null });
    return { name, stateful, seq: this.seq, clock };
  }
  get(name: string): Follower {
    const f = this.followers.get(name);
    if (!f) throw new Refusal("NOT_FOUND", `no follower named ${name} is following`);
    return f;
  }
  /** A follower's events. When its stream closes it has left, and nothing waits for it any more. */
  stream(f: Follower, res: ServerResponse) {
    if (f.stream) throw new Refusal("WRONG_STATE", `${f.name} already has its event stream open`);
    sse(res); f.stream = res;
    res.on("close", () => { this.followers.delete(f.name); this.wake(); });
  }
  watch(res: ServerResponse, clock: object) {
    sse(res); send(res, { type: "clock", reason: "watch", ...clock });
    this.watchers.add(res); res.on("close", () => this.watchers.delete(res));
  }
  ack(f: Follower, seq: number) {
    if (!Number.isSafeInteger(seq) || seq < 0 || seq > this.seq) throw new Refusal("INVALID_INPUT", `seq ${seq} was never sent`);
    f.acked = Math.max(f.acked, seq); this.wake();
  }
  /** A clock event, to watchers and followers alike; followers need not acknowledge it. */
  event(event: object) {
    const out = { ...event, seq: ++this.seq };
    for (const res of this.watchers) send(res, out);
    for (const f of this.followers.values()) { if (f.stream) send(f.stream, out); f.acked = this.seq; }
  }
  nextDue(after: number, until: number): number | null {
    const due = [...this.followers.values()].map((f) => f.nextDue).filter((d): d is number => d !== null && d > after && d <= until);
    return due.length ? Math.min(...due) : null;
  }
  list() { return [...this.followers.values()].map(({ name, stateful, acked, nextDue }) => ({ name, stateful, acked, nextDue, behind: acked < this.seq })); }
  statefulNames() { return [...this.followers.values()].filter((f) => f.stateful).map((f) => f.name); }

  /** A stop: every follower moves to `nowMs` and acknowledges, or the stop does not settle. */
  stop(nowMs: number, version: number, waitMs: number) { return this.round({ type: "stop", nowMs, version }, () => true, waitMs, `the stop at ${new Date(nowMs).toISOString()}`); }
  /** Each stateful follower saves its own state under the world's name before the world is saved; their names go in the manifest. */
  async save(name: string, waitMs: number) { await this.round({ type: "save", world: name }, (f) => f.stateful, waitMs, `saving ${name}`); return this.statefulNames(); }
  restore(name: string, waitMs: number) { return this.round({ type: "restore", world: name }, (f) => f.stateful, waitMs, `restoring ${name}`); }
  close() { for (const res of [...this.watchers, ...[...this.followers.values()].map((f) => f.stream)]) res?.end(); this.followers.clear(); this.watchers.clear(); }

  private async round(event: object, concerned: (f: Follower) => boolean, waitMs: number, what: string) {
    const seq = ++this.seq, out = { ...event, seq };
    for (const f of this.followers.values()) if (f.stream) send(f.stream, out);
    const late = () => [...this.followers.values()].filter((f) => concerned(f) && f.acked < seq);
    const deadline = performance.now() + waitMs;
    while (late().length && performance.now() < deadline) {
      await new Promise<void>((done) => { const t = setTimeout(wake, Math.max(1, deadline - performance.now())); function wake() { clearTimeout(t); done(); } this.waiters.add(wake); });
    }
    for (const f of this.followers.values()) if (!concerned(f)) f.acked = Math.max(f.acked, seq);
    const missing = late();
    if (missing.length) throw new Error(`WORK_DIED: ${what} did not settle: ${missing.map((f) => f.name).join(", ")} did not acknowledge`);
  }
  private wake() { const w = [...this.waiters]; this.waiters.clear(); for (const done of w) done(); }
}
