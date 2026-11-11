/**
 * Evidence, as this repository's runs use it: which agents get which capture tools, what a reader may run on camera,
 * what each agent is told, and what a checker is told about the maker's captures. The captures and their judgment are
 * the evidence module's; this file only decides for Capxul.
 */
import { join } from "node:path";
import { git } from "../../lanes/service.ts";
import { capturesOf, evidenceTools, FOLDER, judge, nodeExec, toolingOf, type Capture, type Judged, type Tooling } from "../../evidence/service.ts";
import { refuseBash } from "../../agents/service.ts";
import type { Job } from "../types.ts";
import type { Agent } from "../../definitions/service.ts";
import { POLICY, SHELLS } from "./config.ts";

export const evidenceDir = (job: Job): string => join(job.run.dir, FOLDER);

/** The programs on this machine: a test's own, or what the run's `PATH` holds. `LOOP_BROWSER=off` takes the browser away. */
export const toolingFor = (job: Job): Tooling => {
  const found = job.ctx.evidence?.tooling ?? toolingOf(job.ctx.env.PATH);
  return job.ctx.env.LOOP_BROWSER === "off" ? { ...found, browser: null } : found;
};

/**
 * What the browser may open: this machine only, which is where a sandbox and a lane's own server are. Never the
 * internet: a page out there is not evidence about this lane, and it can carry instructions.
 */
export const HOSTS: readonly string[] = ["127.0.0.1", "localhost", "*.localhost"];

/**
 * The capture tools for one agent step: those its definition lists, of those this machine can make. A maker records what
 * its shell may run. A reader's shell only reads, so a reader may run the lane's checks and the product only through
 * `record_terminal`: everything it executes is on camera.
 */
export const kitFor = (job: Job, by: string, agent: Agent): ReturnType<typeof evidenceTools> => {
  const cwd = job.lane!.dir, tooling = toolingFor(job);
  const kit = evidenceTools({
    dir: evidenceDir(job), by, cwd, env: job.env, now: job.ctx.now, exec: job.ctx.evidence?.exec ?? nodeExec, tooling,
    refuse: (command) => refuseBash(command, cwd, SHELLS[agent.shell]?.record ?? [], agent.shell === "write" ? { deny: POLICY.denyWrite } : undefined, POLICY.hints),
    hosts: tooling.browser ? HOSTS : [],
  });
  return { tools: kit.tools.filter((t) => agent.tools.includes(t.name)), close: kit.close };
};

/** A reader changes nothing. What its recorded commands left in the lane is undone, and named. */
export const restore = (dir: string): string[] => {
  const left = git(dir, "status", "--porcelain").split("\n").filter(Boolean);
  if (left.length > 0) { git(dir, "reset", "--hard", "-q", "HEAD"); git(dir, "clean", "-fdq"); }
  return left;
};

/** What an agent is told about evidence: the tools it has, and how to claim a capture in its final json. */
export const evidenceBrief = (job: Job, readOnly: boolean): string => {
  const t = toolingFor(job);
  return [
    "## Evidence",
    readOnly
      ? "Show what you checked, do not only say it. Your bash only reads; to run something (a check, the product's command line) use `record_terminal`, which runs one command and records it."
      : "Show that it works, do not only say it. When a command's run is the proof (a check passing, a command refusing what it must refuse), run it with `record_terminal` instead of bash: it runs the command and records it.",
    t.asciinema ? "" : "This machine has no terminal recorder: `record_terminal` will say so. Say in your answer what you could not record.",
    t.browser ? `For anything with a screen: \`browser\` drives a headless browser (it opens only ${HOSTS.join(", ")}), \`screenshot\` captures the page, \`record_screen\` records several steps as one animated picture.` : "",
    "Each tool returns a capture id. In your final json add `\"evidence\": [{ \"capture\": \"<capture id>\", \"shows\": \"<what a person sees in it>\", \"eval\": \"<the eval it is evidence for, if one>\" }]`. A claim that names no capture you made is thrown out.",
  ].filter(Boolean).join("\n");
};

const sourceOf = (c: Capture): string => ("command" in c.source ? `\`${c.source.command}\` ended with ${c.source.exit}` : `${c.source.title || "a page"} at ${c.source.url}`);

/** The claims of step `by`, judged against the run's captures. */
export const claimsOf = (job: Job, by: string, json: unknown): Judged[] =>
  judge((json as { evidence?: unknown } | undefined)?.evidence, capturesOf(evidenceDir(job)), { by, evals: job.task.evals });

/**
 * What a checker is told about the maker's evidence: each claim, with how the capture was really made (the tool wrote
 * that, not the maker), and each claim that named nothing. Empty when the maker claimed nothing.
 */
export const evidenceLines = (job: Job, by: string, json: unknown): string => {
  const captures = capturesOf(evidenceDir(job));
  return claimsOf(job, by, json).map((e) => {
    const c = captures.find((x) => x.id === e.capture);
    return e.ok && c ? `- ${c.kind} \`${c.id}\`${e.eval ? ` for \`${e.eval}\`` : ""}: the maker says it shows "${e.shows}". The loop recorded: ${sourceOf(c)}.` : `- THROWN OUT \`${e.capture}\`: ${e.why}.`;
  }).join("\n");
};
