// Who worked on what, and when: read from git. Each commit is placed on the concepts its files belong to (a path
// segment that is a concept's id: blueprint/payments/…, packages/x/src/payments/…), or on `tooling`.
// Who is the author, or, for a commit an agent made, the agent and the task or session it worked for.

import { spawnSync } from "node:child_process";

export interface Commit {
  readonly sha: string;
  readonly at: string;
  readonly who: string;
  /** `task <id>`, `cloud session`, or empty when a person committed it directly. */
  readonly via: string;
  readonly subject: string;
  readonly files: readonly string[];
}

const SEP = "\u001e";

/** Parses `git log --format=<SEP>%H|%aI|%an|%s|%(trailers…) --name-only` output. */
export const parseLog = (text: string): Commit[] =>
  text.split(SEP).filter((c) => c.trim()).map((chunk) => {
    const [head = "", ...rest] = chunk.split("\n");
    const [sha = "", at = "", author = "", ...subject] = head.split("|");
    const trailers = rest.filter((l) => /^[A-Za-z-]+: /.test(l));
    const task = trailers.find((l) => l.startsWith("Task: "))?.slice(6).trim();
    const session = trailers.some((l) => l.startsWith("Claude-Session: "));
    const files = rest.filter((l) => l.trim() && !/^[A-Za-z-]+: /.test(l));
    const agent = task || session || author === "Claude";
    return {
      sha, at, subject: subject.join("|"), files,
      who: agent ? "Claude" : author,
      via: task ? `task ${task}` : session ? "cloud session" : "",
    };
  });

export const readHistory = (root: string, limit = 2000): Commit[] => {
  const out = spawnSync("git", ["log", `-${limit}`, `--format=${SEP}%H|%aI|%an|%s%n%(trailers:only,unfold)`, "--name-only"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.status === 0 ? parseLog(out.stdout) : [];
};

/** The concept a file belongs to, or `tooling` for everything else (the plan, the factory, the docs, the portal). */
export const areaOf = (file: string, concepts: ReadonlySet<string>): string =>
  file.split("/").slice(0, -1).find((p) => concepts.has(p)) ?? TOOLING;
export const TOOLING = "tooling";
