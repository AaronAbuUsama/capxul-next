/**
 * History: who worked on what, and when, read from git by load.ts. Each commit is placed on the concepts its files belong
 * to (a path segment that is a concept's id: blueprint/payments/…, packages/x/src/payments/…), or on tooling. Who is the
 * git author, or Claude when the commit says an agent made it (a Task or Claude-Session trailer).
 */
import type { CataloguePage, Commit, Ref } from "../types.ts";
import { head, type Ctx } from "./context.ts";
import { row, tableOf, to, words } from "./table.ts";
import { count, plural } from "./values.ts";

export const HISTORY: Ref = { label: "History", page: "history", anchor: "" };
const TOOLING = "tooling";
/** How many days and commits the page lists. */
const DAYS = 30;
const RECENT = 40;

/** Reads `git log --format=<RS>%H|%aI|%an|%s%n%(trailers:only,unfold) --name-only`. */
export const parseLog = (text: string): readonly Commit[] =>
  text.split("\u001e").filter((c) => c.trim()).map((chunk) => {
    const [first = "", ...rest] = chunk.split("\n");
    const [sha = "", at = "", author = "", ...subject] = first.split("|");
    const trailer = (l: string): boolean => /^[A-Za-z-]+: /.test(l);
    const task = rest.find((l) => l.startsWith("Task: "))?.slice(6).trim();
    const session = rest.some((l) => l.startsWith("Claude-Session: "));
    const agent = task !== undefined || session || author === "Claude";
    return {
      sha: sha.slice(0, 7), at, subject: subject.join("|"), who: agent ? "Claude" : author,
      via: task ? `task ${task}` : session ? "cloud session" : "", files: rest.filter((l) => l.trim() !== "" && !trailer(l)),
    };
  });

/** The concept a file belongs to, or tooling for everything else (the plan, the factory, the docs, the portal). */
export const areaOf = (file: string, concepts: ReadonlySet<string>): string =>
  file.split("/").slice(0, -1).find((p) => concepts.has(p)) ?? TOOLING;

const tally = (into: Map<string, number>, key: string): void => { into.set(key, (into.get(key) ?? 0) + 1); };
const listed = (m: ReadonlyMap<string, number>): string =>
  [...m].toSorted(([a, x], [b, y]) => y - x || a.localeCompare(b, "en")).map(([k, n]) => `${k} ${count(n)}`).join(", ");

/** The History page: by concept, by day, and the latest commits. Null when there is no history to read. */
export const history = (ctx: Ctx): CataloguePage | null => {
  const commits = ctx.input.history ?? [];
  if (commits.length === 0) return null;
  const ids = new Set(ctx.input.concepts);
  const areaRef = (a: string): Ref | null => (a === TOOLING ? null : { label: a, page: `concept/${a}`, anchor: "" });
  const cell = (a: string) => { const r = areaRef(a); return r ? to(r) : words(a); };
  const byArea = new Map<string, { n: number; who: Map<string, number>; last: string }>();
  const byDay = new Map<string, { n: number; who: Map<string, number>; areas: Set<string>; verdicts: Map<string, number> }>();
  const day = (d: string) => byDay.get(d) ?? byDay.set(d, { n: 0, who: new Map(), areas: new Set(), verdicts: new Map() }).get(d)!;
  for (const c of commits) {
    const d = day(c.at.slice(0, 10));
    d.n++; tally(d.who, c.who);
    for (const a of new Set(c.files.map((f) => areaOf(f, ids)))) {
      d.areas.add(a);
      const e = byArea.get(a) ?? byArea.set(a, { n: 0, who: new Map(), last: "" }).get(a)!;
      e.n++; tally(e.who, c.who); if (c.at > e.last) e.last = c.at;
    }
  }
  for (const s of Object.values(ctx.input.status?.evals ?? {})) if (s.verdict !== "not_run" && s.at) tally(day(s.at.slice(0, 10)).verdicts, s.verdict);
  const order = [...ctx.input.concepts, TOOLING].filter((a) => byArea.has(a));
  const areas = tableOf("by-concept", "Who worked on each concept", ["Concept", "Commits", "Who", "Last change"],
    order.map((a) => { const e = byArea.get(a)!; return row([cell(a), words(count(e.n)), words(listed(e.who)), words(e.last.slice(0, 16).replace("T", " "))]); }),
    { caption: "A commit counts once for each concept its files touch. Tooling is everything that is not product: the plan, the factory, the docs and the portal." });
  const days = tableOf("timeline", "Timeline", ["Day", "Commits", "Who", "Verdicts recorded", "Concepts touched"],
    [...byDay].toSorted(([a], [b]) => b.localeCompare(a)).slice(0, DAYS).map(([date, d]) =>
      row([words(date), words(count(d.n)), words(listed(d.who)), words(listed(d.verdicts) || "none"), words([...d.areas].toSorted().join(", "))])),
    { caption: `The last ${DAYS} days with a commit or a verdict, newest first.` });
  const recent = tableOf("recent", "Latest commits", ["When", "Who", "What", "Concepts"],
    commits.slice(0, RECENT).map((c) => row([words(c.at.slice(0, 16).replace("T", " ")), words(c.who + (c.via ? ` (${c.via})` : "")), words(c.subject),
      words([...new Set(c.files.map((f) => areaOf(f, ids)))].toSorted().join(", "))])));
  return {
    ...head("history", "History", "git", null), type: "catalogue", nav: "History", eyebrow: "History",
    lead: `Who changed what, and when, from the repository's history: ${plural(commits.length, "commit")} read at this build.`,
    crumbs: [], tiles: [], sections: [areas, days, recent],
  };
};
