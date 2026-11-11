/**
 * The two ways a box is started. `cloudflare`: the Worker in `packages/loop/cloud/worker` starts a container for the run
 * on Cloudflare and forwards the box's routes to it, behind a key. `docker`: the same image on this machine, listening on
 * 127.0.0.1 only; it exists to test the image and the bridge without the cloud, never for real runs.
 */
import { execFileSync } from "node:child_process";
import type { Launcher, Link, Result } from "../types.ts";
import { request } from "./env.ts";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const said = (e: unknown): string => (e as { stderr?: Buffer | string }).stderr?.toString() || (e instanceof Error ? e.message : String(e));

/** Waits until the box answers `/info`: a container that was just started takes a few seconds, a cold image longer. */
export const answers = async (link: Link, ms: number): Promise<Result<Link>> => {
  let last = "";
  for (const until = Date.now() + ms; Date.now() < until; await sleep(1000)) {
    try { await request(link, "GET", "/info", undefined, AbortSignal.timeout(30_000)); return { ok: true, value: link }; } catch (e) { last = said(e); }
  }
  return { ok: false, error: { kind: "box", message: `the box did not answer within ${Math.round(ms / 1000)} s: ${last}` } };
};

/** A box's name: the run's id, in what a container name and a URL path both allow. */
export const nameOf = (id: string): string => `loop-${id.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`.slice(0, 63);

export const docker = (image: string): Launcher => ({
  name: "docker",
  async start(id) {
    const name = nameOf(id), d = (...a: string[]): string => execFileSync("docker", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    try {
      let running = false;
      try { running = d("inspect", "-f", "{{.State.Running}}", name) === "true"; } catch { /* none yet */ }
      if (!running) { try { d("rm", "-f", name); } catch { /* none */ } d("run", "-d", "--name", name, "-p", "127.0.0.1::8080", image); }
      const port = d("port", name, "8080/tcp").split("\n")[0]!.split(":").at(-1)!;
      return answers({ url: `http://127.0.0.1:${port}`, headers: {} }, 60_000);
    } catch (e) { return { ok: false, error: { kind: "box", message: `docker could not start ${name}: ${said(e)}` } }; }
  },
  async stop(id) { try { execFileSync("docker", ["rm", "-f", nameOf(id)], { stdio: "ignore" }); } catch { /* already gone */ } },
});

/** A box that is already running at `url` (a test's, or one started by hand): starting finds it, stopping leaves it. */
export const running = (url: string): Launcher => ({
  name: "docker",
  start: () => answers({ url, headers: {} }, 10_000),
  async stop() { /* not ours to stop */ },
});

/** `url` is the Worker's address; `key` proves the caller is this machine. */
export const cloudflare = (url: string, key: string): Launcher => {
  const headers = { authorization: `Bearer ${key}` }, base = url.replace(/\/$/, "");
  return {
    name: "cloudflare",
    async start(id) {
      const link: Link = { url: `${base}/box/${nameOf(id)}`, headers };
      try { await request(link, "POST", "/start", {}, AbortSignal.timeout(120_000)); }
      catch (e) { return { ok: false, error: { kind: "box", message: `the Worker did not start the box: ${said(e)}` } }; }
      return answers(link, 5 * 60_000);
    },
    async stop(id) { await request({ url: `${base}/box/${nameOf(id)}`, headers }, "POST", "/stop", {}, AbortSignal.timeout(60_000)).catch(() => undefined); },
  };
};
