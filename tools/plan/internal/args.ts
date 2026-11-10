/** The command line as a command: `task block ship-it --need "a key" --who Aaron` in, a `Command` out. */
import type { Command, Result, TaskFields } from "../types.ts";

/** What the CLI does besides changing the plan. */
export type Request =
  | { readonly kind: "show"; readonly json: boolean; readonly task?: string }
  | { readonly kind: "check" }
  | { readonly kind: "answers" }
  | { readonly kind: "answers.apply"; readonly answer: string; readonly evidence: string; readonly by: string }
  | { readonly kind: "change"; readonly command: Command; readonly by: string };

interface Parsed { readonly words: readonly string[]; readonly flags: ReadonlyMap<string, string>; readonly many: readonly string[] }

const parse = (argv: readonly string[]): Result<Parsed> => {
  const words: string[] = [];
  const flags = new Map<string, string>();
  const many: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (!a.startsWith("--")) { words.push(a); continue; }
    const name = a.slice(2);
    const next = argv[i + 1];
    if (name === "json") { flags.set(name, "true"); continue; }
    if (next === undefined) return { ok: false, error: `--${name} needs a value` };
    if (name === "done-when") many.push(next); // repeatable: one line of "done when" each
    else flags.set(name, next);
    i++;
  }
  return { ok: true, value: { words, flags, many } };
};

const list = (s: string | undefined): readonly string[] | undefined => (s === undefined ? undefined : s.split(",").map((x) => x.trim()).filter((x) => x !== ""));

const USAGE = [
  "usage: plan show [<task id>] [--json] | check",
  "       plan answers | answers apply <answer id> --evidence <ref>     (the owner's answers to apply, and marking one applied)",
  "       plan note <text>",
  "       plan goal set [--title <t>] [--why <t>]",
  "       plan exit add <goal|milestone> <id> --claim <t> [--evals a,b] | exit met <goal|milestone> <id> --evidence <ref>",
  "       plan milestone add <id> --title <t> --goal <t> [--order n] [--concepts a,b] | milestone current <id>",
  "       plan task add <id> --title <t> --milestone <id> --why <t> --what <t> --done-when <t> [--done-when <t>…] [--needs a,b] [--records k,k]   (or --detail-file <md> in place of --what and --done-when)",
  "       plan task start <id> --thread <name> | unblock <id> | done <id> [--evidence <ref>] | drop <id> --why <t>",
  "       plan task block <id> (--decision <id> | --need <t> --who <name>)",
  "       plan task edit <id> [--title t] [--why t] [--milestone m] [--needs a,b] [--records k,k] [--thread name]",
  "       plan path set <task ids...> --why <t>        (every change takes --by <name>, default coordinator)",
].join("\n");

const need = (p: Parsed, ...names: string[]): string | null => {
  const absent = names.filter((n) => (p.flags.get(n) ?? "") === "");
  return absent.length ? `needs ${absent.map((n) => `--${n}`).join(" and ")}` : null;
};
const fail = (error: string): Result<never> => ({ ok: false, error: `${error}\n${USAGE}` });

const fieldsOf = (p: Parsed): TaskFields => {
  const f = (n: string): string | undefined => p.flags.get(n);
  const needs = list(f("needs")), records = list(f("records"));
  return {
    ...(f("title") !== undefined ? { title: f("title") as string } : {}), ...(f("why") !== undefined ? { why: f("why") as string } : {}),
    ...(f("milestone") !== undefined ? { milestone: f("milestone") as string } : {}), ...(f("thread") !== undefined ? { thread: f("thread") as string } : {}),
    ...(needs ? { needs } : {}), ...(records ? { records } : {}),
  };
};

/** Turns arguments into a request, or says what is wrong with them. */
export const parseArgs = (argv: readonly string[]): Result<Request> => {
  const p = parse(argv);
  if (!p.ok) return fail(p.error);
  const { words, flags } = p.value;
  const [a, b, c, ...rest] = words;
  const f = (n: string): string => flags.get(n) ?? "";
  const by = f("by") || "coordinator";
  const change = (command: Command): Result<Request> => ({ ok: true, value: { kind: "change", command, by } });
  const missing = (...names: string[]): string | null => need(p.value, ...names);
  const bad = (m: string | null): Result<never> | null => (m ? fail(m) : null);

  if (a === "show") return { ok: true, value: { kind: "show", json: flags.has("json"), ...(b !== undefined ? { task: b } : {}) } };
  if (a === "answers" && b === undefined) return { ok: true, value: { kind: "answers" } };
  if (a === "answers" && b === "apply" && c !== undefined) return bad(missing("evidence")) ?? { ok: true, value: { kind: "answers.apply", answer: c, evidence: f("evidence"), by } };
  if (a === "check") return { ok: true, value: { kind: "check" } };
  if (a === "note") return b === undefined ? fail("note needs the text") : change({ kind: "note", text: [b, c, ...rest].filter((x) => x !== undefined).join(" ") });
  if (a === "goal" && b === "set") return change({ kind: "goal.set", ...(flags.has("title") ? { title: f("title") } : {}), ...(flags.has("why") ? { why: f("why") } : {}) });
  if (a === "exit" && b === "add" && c !== undefined && rest[0] !== undefined)
    return bad(missing("claim")) ?? change({ kind: "exit.add", owner: c, id: rest[0], claim: f("claim"), ...(flags.has("evals") ? { evals: list(f("evals")) as readonly string[] } : {}) });
  if (a === "exit" && b === "met" && c !== undefined && rest[0] !== undefined)
    return bad(missing("evidence")) ?? change({ kind: "exit.met", owner: c, id: rest[0], evidence: f("evidence") });
  if (a === "milestone" && b === "add" && c !== undefined)
    return bad(missing("title", "goal")) ?? change({
      kind: "milestone.add", id: c, title: f("title"), goal: f("goal"),
      ...(flags.has("order") ? { order: Number(f("order")) } : {}), ...(flags.has("concepts") ? { concepts: list(f("concepts")) as readonly string[] } : {}),
    });
  if (a === "milestone" && b === "current" && c !== undefined) return change({ kind: "milestone.current", id: c });
  if (a === "path" && b === "set") return bad(missing("why")) ?? change({ kind: "path.set", tasks: [c, ...rest].filter((x): x is string => x !== undefined), why: f("why") });
  if (a === "task" && c !== undefined) {
    switch (b) {
      case "add":
        return bad(missing("title", "why", "milestone")) ?? change({
          kind: "task.add", id: c, title: f("title"), why: f("why"), milestone: f("milestone"),
          ...(flags.has("what") ? { what: f("what") } : {}), ...(p.value.many.length ? { doneWhen: p.value.many } : {}), ...(flags.has("detail-file") ? { detailFile: f("detail-file") } : {}),
          ...(flags.has("needs") ? { needs: list(f("needs")) as readonly string[] } : {}), ...(flags.has("records") ? { records: list(f("records")) as readonly string[] } : {}),
        });
      case "start": return bad(missing("thread")) ?? change({ kind: "task.start", id: c, thread: f("thread") });
      case "block":
        if (flags.has("decision")) return change({ kind: "task.block", id: c, blocker: { decision: f("decision") } });
        return bad(missing("need", "who")) ?? change({ kind: "task.block", id: c, blocker: { need: f("need"), who: f("who") } });
      case "unblock": return change({ kind: "task.unblock", id: c });
      case "done": return change({ kind: "task.done", id: c, ...(flags.has("evidence") ? { evidence: f("evidence") } : {}) });
      case "drop": return bad(missing("why")) ?? change({ kind: "task.drop", id: c, why: f("why") });
      case "edit": return change({ kind: "task.edit", id: c, fields: fieldsOf(p.value) });
    }
  }
  return fail(a === undefined ? "no command" : `not a command: ${words.join(" ")}`);
};
