/**
 * The prompts: docs/design/swarm-templates.md sections 2.1 and 2.2 rendered from a task, ending in the exact input as a
 * json block (when the rendering and the block disagree, the block wins). Pure functions.
 */
import type { Finding, Handover, Task } from "../types.ts";

export interface MakerInput { task: Task; round: number; budgetUsd: number; spentUsd: number; branch: string; sandbox: string; open: Finding[]; handover?: Handover }

const findings = (open: readonly Finding[]): string =>
  open.length === 0 ? "_none_" : open.map((f) => `- ${f.id ?? "F"} ${f.severity}${f.check ? ` \`${f.check}\`` : ""}${f.where ? ` at ${f.where.path}${f.where.line ? `:${f.where.line}` : ""}` : ""}: ${f.text}`).join("\n");

const handover = (h?: Handover): string => {
  if (!h) return "_none: this is round 1_";
  const part = (title: string, lines: readonly string[]): string[] => [`${title}:`, ...lines.map((l) => `- ${l}`)];
  return [...part("Done", h.done), ...part("Left", h.left), ...part("Decisions", h.decisions), ...part("Where", h.where)].join("\n");
};

/** What the runner tells every agent about the ground rules, whoever it is. */
const GROUND = (sandbox: string, checks: readonly string[]): string => [
  "## Where you are",
  "You are inside a git worktree (a lane) on its own branch. Change files only inside it. Never push, never touch another branch, never change the frozen baseline (`books/frozen/`, or `blueprint/baseline/` once the design folder is renamed) or any `src/generated/` folder.",
  "Read `CLAUDE.md` first. The book changes first: change the record and add a decision record, rebuild the book to 0 problems, then the code.",
  "The runner runs these checks after you, and you may run them yourself first (your shell is limited to `pnpm`'s scripts, `node`, `git` and a few file commands). The design must build with 0 problems and the frozen check must find 0 breaches:",
  ...checks.map((c) => `- \`${c}\``),
  sandbox ? `\n## Sandbox\n${sandbox}` : "",
].join("\n");

/** `checks` are the commands the runner runs after the maker (the lane's gates), told to it so it can run them first. */
export const makerPrompt = (i: MakerInput, checks: readonly string[]): string => [
  `# Task \`${i.task.id}\`: ${i.task.title}`,
  `Round ${i.round} of the run · budget $${i.budgetUsd.toFixed(2)}, spent $${i.spentUsd.toFixed(2)} · target integration/build · branch ${i.branch}`,
  i.round > 1 ? "Revise: the last round did not pass. The open findings below are what to fix; a failing check is a finding." : "",
  "\n## Goal", i.task.goal,
  "\n## Evals", i.task.evals.length ? i.task.evals.map((e) => `- \`${e}\``).join("\n") : "_this task has no evals of its own: its done-when above is the definition_",
  "\n## Brief", i.task.paths.length ? `Paths you may change: ${i.task.paths.join(", ")}` : "Paths you may change: only what the task needs.",
  "\n## Open findings", findings(i.open),
  "\n## Handover from the last maker", handover(i.handover),
  "\n" + GROUND(i.sandbox, checks),
  "\n## How this differs from your definition",
  "You may `git add` and `git commit` on the current branch (subject `<what changed>`, trailers `Task:` and `Round:`); the runner commits what you leave. You cannot push, and must not try. There is no pull request: set `pr` to 0.",
  "Your last message is the Handback as one fenced json block and nothing after it.",
  "\n## The input, exactly", "```json", JSON.stringify(i, null, 2), "```",
].filter((x) => x !== "").join("\n");

export interface CheckInput { task: Task; role: string; round: number; version: string; from: string; machine: string; open: Finding[]; note: string; branch: string }

export const checkerPrompt = (i: CheckInput): string => [
  `# Check \`${i.task.id}\` at ${i.version.slice(0, 7)}, round ${i.round}`,
  `You are the ${i.role}. Run \`git diff ${i.from}..${i.version}\` and read what it changes. You have read-only tools: you cannot and must not change anything.`,
  "\n## Goal", i.task.goal,
  "\n## Evals", i.task.evals.length ? i.task.evals.map((e) => `- \`${e}\``).join("\n") : "_none of its own: judge against the done-when in the goal_",
  "\n## Machine verdicts at this version (the runner ran them)", i.machine,
  "\n## Open findings", findings(i.open),
  "\n## The maker's note", i.note || "_none_",
  "\nThe repository's rules are in `CLAUDE.md`. There is no pull request: the version is the commit above.",
  "Your last message is the check as one fenced json block and nothing after it.",
  "\n## The input, exactly", "```json", JSON.stringify({ version: { kind: "commit", commit: i.version }, from: i.from, round: i.round, open: i.open }, null, 2), "```",
].join("\n");

export const researchPrompt = (task: Task, sandbox: string): string => [
  `# Question \`${task.id}\`: ${task.title}`, "\n## The question", task.goal, sandbox ? `\n## Sandbox\n${sandbox}` : "",
  "Read `CLAUDE.md` first, then the design guide it names.",
  "You are read-only: you cannot change anything and must not try. There is no web access here: answer from this repository and the old system if it is on disk.",
  "Your last message is the research answer as one fenced json block and nothing after it.",
].join("\n");
