/** Read-only landing snapshots, rendered by the serving portal. Never checks out or merges the fetched branch. */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
export const LANDING_BRANCH = "integration/wave-0";
const LANDING_REF = `origin/${LANDING_BRANCH}`;
export interface LiveInfo { readonly version: string; readonly at: string; readonly source: string; readonly commit: string; readonly error: string | null }
const INPUTS = ["blueprint", "packages/portal/src", "packages/portal/assets", "packages/portal/content", "packages/blueprint-engine/src", "plan", "status", "evals/bindings", "docs"];

/** Reuse installed external dependencies, but resolve workspace packages to the snapshot's own engine and renderer. */
const linkSnapshot = (root: string, snapshot: string): void => {
  const modules = join(snapshot, "node_modules");
  mkdirSync(modules);
  for (const name of readdirSync(join(root, "node_modules")).filter((n) => !n.startsWith(".") && n !== "@capxul")) {
    symlinkSync(join(root, "node_modules", name), join(modules, name), "dir");
  }
  mkdirSync(join(modules, "@capxul"), { recursive: true });
  for (const name of readdirSync(join(snapshot, "packages"))) {
    const folder = join(snapshot, "packages", name), manifest = join(folder, "package.json");
    if (!existsSync(manifest)) continue;
    const pkg = JSON.parse(readFileSync(manifest, "utf8")) as { name: string };
    symlinkSync(folder, join(modules, pkg.name), "dir");
  }
};

/** Metadata, not the global scoreboard alone: a run can start/finish without changing global status. */
const fingerprint = async (root: string): Promise<string> => {
  const { stdout } = await exec("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...INPUTS], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
  const hash = createHash("sha256");
  for (const file of stdout.split("\0").filter(Boolean).sort()) {
    try { const s = statSync(join(root, file)); hash.update(`${file}:${s.size}:${s.mtimeMs}\n`); } catch { hash.update(`${file}:deleted\n`); }
  }
  const head = await exec("git", ["rev-parse", "HEAD"], { cwd: root });
  return hash.update(head.stdout).digest("hex");
};

export const startLive = (root: string, log: (line: string) => void = console.log): { info: () => LiveInfo; ready: Promise<void>; close: () => void } => {
  const work = join(root, "var/portal-live");
  const dist = join(root, "packages/portal/dist");
  mkdirSync(work, { recursive: true });
  let info: LiveInfo = { version: "starting", at: "", source: "local checkout", commit: "", error: null };
  let local = "", remote = "", available = "", fetched = 0, busy = false, stopped = false;
  let fetchError: string | null = null;
  const refresh = async () => {
    if (busy || stopped) return;
    busy = true;
    let snapshot: string | null = null;
    try {
      const current = await fingerprint(root);
      let source = root;
      let commit = (await exec("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
      let changed = current !== local;
      let sourceName = "local checkout";
      if (Date.now() - fetched >= 60_000) {
        fetched = Date.now();
        try {
          await exec("git", ["fetch", "--quiet", "origin", `refs/heads/${LANDING_BRANCH}:refs/remotes/${LANDING_REF}`], { cwd: root, timeout: 30_000 });
          available = (await exec("git", ["rev-parse", LANDING_REF], { cwd: root })).stdout.trim();
          if (!remote) remote = commit;
          fetchError = null;
        } catch { fetchError = `Could not refresh ${LANDING_BRANCH}; showing the last available inputs.`; }
      }
      changed ||= available !== "" && available !== remote;
      if (changed && available && available !== commit) {
        snapshot = join(work, `snapshot-${available}`);
        mkdirSync(snapshot, { recursive: true });
        const archive = join(work, "source.tar");
        await exec("git", ["archive", "--format=tar", `--output=${archive}`, available], { cwd: root });
        await exec("tar", ["-xf", archive, "-C", snapshot]);
        rmSync(archive);
        linkSnapshot(root, snapshot);
        // Newly started local runs remain visible against the landed blueprint; never replace a published run with a local copy.
        const runs = join(root, "status/runs");
        if (existsSync(runs)) for (const id of readdirSync(runs)) {
          const destination = join(snapshot, "status/runs", id);
          if (!existsSync(destination) && existsSync(join(runs, id, "receipt.json"))) cpSync(join(runs, id), destination, { recursive: true });
        }
        source = snapshot; commit = available; sourceName = LANDING_REF; changed = true;
      }
      if (changed) {
        const version = createHash("sha256").update(current + commit + sourceName).digest("hex").slice(0, 16);
        const stage = join(work, "next");
        rmSync(stage, { recursive: true, force: true });
        // Before this board first lands, use the serving renderer. Afterwards each landing renders with its own engine/IDs.
        const renderer = existsSync(join(source, "packages/portal/src/live.ts")) ? source : root;
        const { stdout } = await exec(process.execPath, ["--experimental-strip-types", "--no-warnings", join(renderer, "packages/portal/src/main.ts"), "generate", stage, "--root", source],
          { cwd: root, timeout: 120_000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, PORTAL_BUILT_COMMIT: commit, PORTAL_GIT_ROOT: root } });
        if (stopped) return;
        for (const file of readdirSync(stage, { recursive: true }).map(String).filter((f) => f.endsWith(".html"))) {
          const path = join(stage, file);
          writeFileSync(path, readFileSync(path, "utf8").replace("</head>", `<meta name="portal-generation" content="${version}"></head>`));
        }
        const previous = join(work, "previous");
        rmSync(previous, { recursive: true, force: true });
        if (existsSync(dist)) renameSync(dist, previous);
        renameSync(stage, dist);
        rmSync(previous, { recursive: true, force: true });
        local = current;
        if (sourceName === LANDING_REF) remote = available;
        info = { version, at: new Date().toISOString(), source: sourceName, commit, error: fetchError };
        log(`Live portal refreshed from ${sourceName} at ${commit.slice(0, 7)}: ${stdout.trim()}`);
      } else if (fetchError) info = { ...info, error: fetchError };
      else info = { ...info, error: null };
    } catch (error) {
      info = { ...info, error: `Refresh failed; retaining the last good pages. ${error instanceof Error ? error.message.split("\n")[0] : String(error)}` };
      log(info.error!);
    } finally {
      if (snapshot) rmSync(snapshot, { recursive: true, force: true });
      busy = false;
    }
  };
  const timer = setInterval(() => { void refresh(); }, 5_000);
  const ready = refresh();
  return { info: () => info, ready, close: () => { stopped = true; clearInterval(timer); } };
};
