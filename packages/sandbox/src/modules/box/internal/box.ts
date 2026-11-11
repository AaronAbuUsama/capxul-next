/**
 * A box reached through its link: commands run to their end, and the lane carried in and out as git bundles. The lane
 * here is the source of truth between steps; the box's copy is made to match it (`push`) and its new commits come back
 * (`pull`). The image holds a checkout of the repository with its packages installed, so a bundle carries only the
 * commits the image lacks and the box needs no network.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT, withCancel } from "@earendil-works/chord/context";
import type { Box, BoxInfo, Link, Ran, Result, RunOptions } from "../types.ts";
import { BoxEnv, request } from "./env.ts";

const git = (cwd: string, ...args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 }).trim();
const has = (cwd: string, sha: string): boolean => { try { git(cwd, "cat-file", "-e", `${sha}^{commit}`); return true; } catch { return false; } };
const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const fail = <T>(message: string): Result<T> => ({ ok: false, error: { kind: "box", message } });
const said = (e: unknown): string => (e as { stderr?: string }).stderr || (e instanceof Error ? e.message : String(e));

/** Who the commits made in the box are by: the lane's own git identity here. */
const author = (dir: string): Record<string, string> => {
  const name = (() => { try { return git(dir, "config", "user.name"); } catch { return "loop"; } })();
  const email = (() => { try { return git(dir, "config", "user.email"); } catch { return "loop@localhost"; } })();
  return { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
};

const upload = async (link: Link, path: string, bytes: Uint8Array): Promise<void> => {
  const res = await fetch(`${link.url}/blob?path=${encodeURIComponent(path)}`, { method: "PUT", headers: { ...link.headers, "content-type": "application/octet-stream" }, body: new Blob([new Uint8Array(bytes)]) });
  if (!res.ok) throw new Error(`the box refused the upload of ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
};
const download = async (link: Link, path: string): Promise<Uint8Array> => {
  const res = await fetch(`${link.url}/blob?path=${encodeURIComponent(path)}`, { headers: link.headers });
  if (!res.ok) throw new Error(`the box has no ${path}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};

export const boxOf = (link: Link): Box => {
  const run = async (command: string | readonly string[], o: RunOptions): Promise<Ran> => {
    const { context, cancel } = withCancel(BACKGROUND_CONTEXT);
    let out = "", stopped = false;
    const watch = o.stopped ? setInterval(() => { if (o.stopped!()) { stopped = true; cancel(); } }, 1000) : undefined;
    try {
      const r = await new BoxEnv(link, o.cwd).exec(command, {
        ...(o.env ? { env: { ...o.env } } : {}), ...(o.timeoutMs ? { timeout: Math.ceil(o.timeoutMs / 1000) } : {}),
        onOutput: (t) => { out = (out + t).slice(-100_000); o.onOutput?.(t); },
      }, context);
      if (r.ok) return { code: r.value.exitCode, out, timedOut: false, stopped };
      return { code: null, out: `${out}\n${r.error.message}`, timedOut: r.error.code === "timeout", stopped: stopped || r.error.code === "aborted" };
    } finally { clearInterval(watch); }
  };
  const sh = async (cwd: string, script: string, env: Record<string, string> = {}, timeoutMs = 600_000): Promise<string> => {
    const r = await run(script, { cwd, env, timeoutMs });
    if (r.code !== 0) throw new Error(`in the box, \`${script.slice(0, 160)}\` ended ${r.code ?? "killed"}: ${r.out.slice(-600)}`);
    return r.out.trim();
  };
  const info = async (): Promise<Result<BoxInfo>> => { try { return { ok: true, value: await request(link, "GET", "/info") as BoxInfo }; } catch (e) { return fail(said(e)); } };

  const push = async (dir: string, branch: string): Promise<Result<string>> => {
    const i = await info();
    if (!i.ok) return i;
    const { commit, repo } = i.value, tip = git(dir, "rev-parse", "HEAD"), tmp = mkdtempSync(join(tmpdir(), "box-"));
    try {
      // Only the commits the image lacks travel; a lane the image already holds needs no bundle at all.
      const needs = !(has(dir, commit) && git(dir, "rev-list", "-n1", tip, `^${commit}`) === "");
      if (needs) {
        const bundle = join(tmp, "lane.bundle");
        git(dir, "bundle", "create", "-q", bundle, `refs/heads/${branch}`, ...(has(dir, commit) ? [`^${commit}`] : []));
        await upload(link, "/tmp/lane.bundle", readFileSync(bundle));
      }
      await sh("/", [
        `mkdir -p ${q(dir)}`, `cd ${q(dir)}`,
        `[ -e .git ] || git clone -q --no-checkout ${q(repo)} .`,
        ...(needs ? [`git fetch -q /tmp/lane.bundle ${q(`refs/heads/${branch}:refs/heads/mac/${branch}`)} --update-head-ok -f`] : []),
        // A box lane already at the tip keeps what it has uncommitted: a resumed agent finds its work where it left it.
        `{ [ "$(git rev-parse -q --verify HEAD)" = ${tip} ] || { git checkout -q -f -B ${q(branch)} ${tip} && git reset -q --hard ${tip} && git clean -fdq -e node_modules; }; }`,
        // The image's store has every package of its lockfile; a lane whose lockfile asks for more fails here and says so.
        `[ -d node_modules ] || [ ! -f pnpm-lock.yaml ] || pnpm install --frozen-lockfile --offline --reporter=silent`,
      ].join(" && "), author(dir), 900_000);
      return { ok: true, value: tip };
    } catch (e) { return fail(said(e)); } finally { rmSync(tmp, { recursive: true, force: true }); }
  };

  const pull = async (dir: string, branch: string, message: string): Promise<Result<string>> => {
    const tmp = mkdtempSync(join(tmpdir(), "box-"));
    try {
      const here = git(dir, "rev-parse", "HEAD");
      const tip = (await sh(dir, `git add -A && { git diff --cached --quiet || git commit -q -m ${q(message)}; } && git rev-parse HEAD`, author(dir))).split("\n").at(-1)!;
      if (tip === here) return { ok: true, value: tip };
      await sh(dir, `git bundle create -q /tmp/back.bundle ${q(branch)} ^${here}`);
      const bundle = join(tmp, "back.bundle");
      writeFileSync(bundle, await download(link, "/tmp/back.bundle"));
      git(dir, "fetch", "-q", bundle, branch);
      git(dir, "merge", "-q", "--ff-only", "FETCH_HEAD");
      return { ok: true, value: git(dir, "rev-parse", "HEAD") };
    } catch (e) { return fail(said(e)); } finally { rmSync(tmp, { recursive: true, force: true }); }
  };

  const restore = async (dir: string): Promise<Result<string[]>> => {
    try {
      const left = (await sh(dir, "git status --porcelain")).split("\n").filter(Boolean);
      if (left.length > 0) await sh(dir, "git reset --hard -q HEAD && git clean -fdq -e node_modules");
      return { ok: true, value: left };
    } catch (e) { return fail(said(e)); }
  };

  return { link, info, env: (cwd, vars) => new BoxEnv(link, cwd, vars), run, push, pull, restore };
};
