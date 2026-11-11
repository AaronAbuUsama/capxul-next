/**
 * Where boxes run. `cloudflare`: the Worker in `packages/sandbox/worker` starts a container per box on Cloudflare,
 * forwards the box's routes to it behind a key, keeps a registry of live boxes, and destroys each at its expiry.
 * `docker`: the same image on this machine, on 127.0.0.1 only, with the owner and expiry as labels; for testing the
 * image without the cloud. `running`: one box already up at an address, for tests.
 */
import { execFileSync } from "node:child_process";
import type { BoxRecord, Launcher, Link, Result, StartOptions } from "../types.ts";
import { request } from "./env.ts";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const said = (e: unknown): string => (e as { stderr?: Buffer | string }).stderr?.toString() || (e instanceof Error ? e.message : String(e));
const fail = <T>(message: string): Result<T> => ({ ok: false, error: { kind: "box", message } });

/** The longest a box may live: Cloudflare keeps an idle container at most six hours, and so do we, everywhere. */
export const MAX_TTL_MS = 6 * 60 * 60 * 1000;

/** Waits until the box answers `/info`: a container that was just started takes a few seconds, a cold image longer. */
export const answers = async (link: Link, ms: number): Promise<Result<Link>> => {
  let last = "";
  for (const until = Date.now() + ms; Date.now() < until; await sleep(1000)) {
    try { await request(link, "GET", "/info", undefined, AbortSignal.timeout(30_000)); return { ok: true, value: link }; } catch (e) { last = said(e); }
  }
  return fail(`the box did not answer within ${Math.round(ms / 1000)} s: ${last}`);
};

/** A box's name as a container name and a URL path both allow it: lower case, digits and dashes, at most 50. */
export const nameOf = (name: string): string => name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+/, "").slice(0, 50) || "box";

const checked = (o: StartOptions): StartOptions | string =>
  !(o.ttlMs > 0) ? "a box needs a time to live above zero" : o.ttlMs > MAX_TTL_MS ? `a box lives at most ${MAX_TTL_MS / 3_600_000} hours` : !/^[\w.:-]{1,80}$/.test(o.owner) ? "an owner is letters, digits, . _ : - (at most 80)" : o;

export const docker = (image: string, now: () => Date = () => new Date()): Launcher => {
  const d = (...a: string[]): string => execFileSync("docker", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const container = (name: string): string => `capxul-box-${nameOf(name)}`;
  const linkOf = (name: string): Result<Link> => {
    try { return { ok: true, value: { url: `http://127.0.0.1:${d("port", container(name), "8080/tcp").split("\n")[0]!.split(":").at(-1)}`, headers: {} } }; }
    catch (e) { return fail(`there is no box ${name}: ${said(e)}`); }
  };
  return {
    name: "docker",
    async start(name, o) {
      const ok = checked(o);
      if (typeof ok === "string") return fail(ok);
      try {
        let up = false;
        try { up = d("inspect", "-f", "{{.State.Running}}", container(name)) === "true"; } catch { /* none yet */ }
        if (!up) {
          try { d("rm", "-f", container(name)); } catch { /* none */ }
          const t = now();
          d("run", "-d", "--name", container(name), "-p", "127.0.0.1::8080", "--label", "capxul.box=1", "--label", `capxul.box.name=${nameOf(name)}`,
            "--label", `capxul.box.owner=${o.owner}`, "--label", `capxul.box.started=${t.toISOString()}`, "--label", `capxul.box.expires=${new Date(t.getTime() + o.ttlMs).toISOString()}`, image);
        }
        const link = linkOf(name);
        return link.ok ? answers(link.value, 60_000) : link;
      } catch (e) { return fail(`docker could not start ${name}: ${said(e)}`); }
    },
    link: linkOf,
    async stop(name) { try { d("rm", "-f", container(name)); } catch { /* already gone */ } },
    async list() {
      try {
        const lines = d("ps", "-a", "--filter", "label=capxul.box=1", "--format", "{{json .}}").split("\n").filter(Boolean);
        return { ok: true, value: lines.map((l) => {
          const c = JSON.parse(l) as { Labels: string; State: string };
          const label = (k: string): string => new RegExp(`(?:^|,)capxul\\.box\\.${k}=([^,]*)`).exec(c.Labels)?.[1] ?? "";
          return { name: label("name"), owner: label("owner"), startedAt: label("started"), expiresAt: label("expires"), running: c.State === "running" } satisfies BoxRecord;
        }) };
      } catch (e) { return fail(`docker could not list the boxes: ${said(e)}`); }
    },
  };
};

/** A box already running at `url` (a test's): starting finds it, stopping and listing know nothing more. */
export const running = (url: string): Launcher => ({
  name: "running",
  start: () => answers({ url, headers: {} }, 10_000),
  link: () => ({ ok: true, value: { url, headers: {} } }),
  async stop() { /* not ours to stop */ },
  list: async () => ({ ok: true, value: [] }),
});

/** `url` is the Worker's address; `key` proves the caller may use it. */
export const cloudflare = (url: string, key: string): Launcher => {
  const headers = { authorization: `Bearer ${key}` }, base = url.replace(/\/$/, "");
  const linkOf = (name: string): Link => ({ url: `${base}/box/${nameOf(name)}`, headers });
  return {
    name: "cloudflare",
    async start(name, o) {
      const ok = checked(o);
      if (typeof ok === "string") return fail(ok);
      try { await request(linkOf(name), "POST", "/start", { owner: o.owner, ttlMs: o.ttlMs }, AbortSignal.timeout(150_000)); }
      catch (e) { return fail(`the Worker did not start the box: ${said(e)}`); }
      return answers(linkOf(name), 5 * 60_000);
    },
    link: (name) => ({ ok: true, value: linkOf(name) }),
    async stop(name) { await request(linkOf(name), "POST", "/stop", {}, AbortSignal.timeout(60_000)).catch(() => undefined); },
    async list() {
      try { return { ok: true, value: (await request({ url: base, headers }, "GET", "/boxes", undefined, AbortSignal.timeout(60_000)) as { boxes: BoxRecord[] }).boxes }; }
      catch (e) { return fail(`the Worker did not list the boxes: ${said(e)}`); }
    },
  };
};

/**
 * The runaway guard's sweep: stops every box past its expiry, every box that is not running (its record is cleared),
 * and every box `keep` says is no longer wanted (its owner has ended). Returns what it stopped, or would have.
 */
export const reap = async (l: Launcher, o: { now: Date; keep?: (b: BoxRecord) => boolean; dryRun?: boolean }): Promise<Result<{ box: BoxRecord; why: string }[]>> => {
  const all = await l.list();
  if (!all.ok) return all;
  const gone = all.value.flatMap((box) => {
    const why = !box.running ? "not running" : Date.parse(box.expiresAt) <= o.now.getTime() ? "past its expiry" : o.keep && !o.keep(box) ? "its owner has ended" : "";
    return why ? [{ box, why }] : [];
  });
  if (!o.dryRun) for (const g of gone) await l.stop(g.box.name);
  return { ok: true, value: gone };
};
