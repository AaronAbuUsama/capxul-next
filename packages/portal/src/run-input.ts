/** Read immutable same-run evidence, never reconstruct a run from the merged scoreboard. */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import * as engine from "@capxul/blueprint-engine";
import { parseStatus, type SliceRun } from "@capxul/blueprint-engine";
import { LANDING_BRANCH } from "./live.ts";

// Only the fields this reader consumes. The engine owns validation and the full receipt schema.
type Receipt = Omit<SliceRun, "status" | "landed"> & { readonly finishedAt?: string; readonly evals: readonly { readonly id: string; readonly claim: string; readonly observes?: string }[];
  readonly scripts: readonly { readonly exitCode: number | null; readonly signal: string | null }[] };
type Parsed = { readonly ok: true; readonly value: Receipt } | { readonly ok: false; readonly errors: readonly string[] };

export const sliceRunsOf = (root: string, gitRoot = root): readonly SliceRun[] => {
  const folder = join(root, "status/runs");
  if (!existsSync(folder)) return [];
  const receipts = readdirSync(folder).sort().filter((id) => existsSync(join(folder, id, "receipt.json")));
  // Historical trees have no receipts and need no parser. Use the engine export when new harness receipts appear.
  const parse: unknown = Reflect.get(engine, "parseRunReceipt");
  if (receipts.length && typeof parse !== "function") throw new Error("Run receipts require the stable-eval engine's parseRunReceipt export.");
  let ancestors = new Set<string>();
  try { ancestors = new Set(execFileSync("git", ["rev-list", `origin/${LANDING_BRANCH}`], { cwd: gitRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n")); } catch { /* no merge provenance: do not claim landed */ }
  return receipts.map((id) => {
    const directory = join(folder, id);
    const receipt = (parse as (u: unknown) => Parsed)(JSON.parse(readFileSync(join(directory, "receipt.json"), "utf8")) as unknown);
    if (!receipt.ok) throw new Error(`${id}/receipt.json: ${receipt.errors.join("; ")}`);
    const r = receipt.value;
    if (r.id !== id) throw new Error(`${id}/receipt.json: run ID differs from its folder`);
    const statusFile = join(directory, "status.json");
    const status = parseStatus(existsSync(statusFile) ? JSON.parse(readFileSync(statusFile, "utf8")) as unknown : { version: 1, evals: {} });
    if (!status.ok) throw new Error(`${id}/status.json: ${status.errors.join("; ")}`);
    const snapshots = { version: 1 as const, evals: Object.fromEntries(Object.entries(status.value.evals).filter(([key, s]) =>
      r.requested.includes(key) && s.run === r.id && s.commit === r.commit && r.evals.some((e) => e.id === key && e.claim === s.claim && e.observes === s.observes))) };
    const screens = r.screens.filter((s) => {
      const path = resolve(directory, s.path);
      return path.startsWith(resolve(directory) + sep) && existsSync(path) && statSync(path).isFile() && realpathSync(path).startsWith(realpathSync(directory) + sep) && s.assertion === "source-equality";
    });
    return { ...r, screens, state: r.state === "complete" && (!r.finishedAt || !r.scripts.length || r.scripts.some((s) => s.exitCode !== 0 || s.signal !== null)) ? "incomplete" : r.state,
      status: snapshots, landed: ancestors.has(r.commit) };
  });
};
