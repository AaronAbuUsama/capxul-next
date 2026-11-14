// Renders claims.md from the declarations: the claims, the starting worlds and each operation's refusals, events
// and budget. Pure: `render.entry.ts` writes the file, and a test compares it with this.
import * as Arr from "effect/Array";
import { pipe } from "effect/Function";
import * as Rec from "effect/Record";
import { operations, servedBy, type OperationName } from "../door.ts";
import { refusalsOf, type Operation } from "../operation.ts";
import { startingWorlds } from "../starting-worlds.ts";
import { allClaims } from "./all.ts";
import type { Claim, ClaimsOf } from "./claim.ts";

const code = (text: string) => `\`${text}\``;
const list = (items: ReadonlyArray<string>) => (items.length === 0 ? "none" : Arr.join(items, ", "));

const header = `# Acceptance claims of the thin line

Rendered from \`src/<concept>/claims.ts\` and the declarations by \`pnpm claims\`. Do not edit it by hand: a test fails
when this file and its sources differ.

Each claim is checked black-box by the journeys (\`packages/scenarios\`; docs/roadmap.md, "Scenarios are journeys"):
through the door, reading only what the operations answer and what the world's door shows of its chain. No claim has
a scenario of its own. Its operation's checks run on every call of that operation in every journey, and the journeys'
steps call it as the claim says; \`packages/scenarios/src/coverage.ts\` names, for each claim, the checks and the
steps. "In" names the starting world whose state a claim speaks of: a journey checks it in that state, whether it
starts from that world or starts earlier and brings its world there by its own steps. "Old" names the claim of the old
blueprint (\`docs/thin-line/operations.json\`, its \`evalId\`) it keeps, word for word or rewritten.

## What the runner checks on every call

These hold for every call of every journey, so no claim repeats them:

1. A successful call emits exactly the events its outcome declares, each once, each carrying exactly what the
   declaration computes from the call's payload and answer, and nothing more. A refused call emits none.
2. A refusal is one the operation declares.
3. The call's spans are recorded under the trace id the caller sent, the first named after the operation.
4. The call's time, as the caller saw it and as the server's span measured it, is stored with the run, with the
   time of each step beneath it, next to the operation's budget. A budget is recorded, not enforced: nothing fails
   on speed until a budget is set from measured runs.
`;

const origin = (claim: Claim): ReadonlyArray<string> => {
  if (claim.origin === null) return ["   - Old: none; this claim is new."];
  if (claim.origin.kept === "word for word") return [`   - Old: ${code(claim.origin.id)}, kept word for word.`];
  return [`   - Old: ${code(claim.origin.id)}, rewritten. It said: "${claim.origin.was}" Why: ${claim.origin.why}`];
};

const budget = (operation: Operation) =>
  `${operation.budget.ms.toLocaleString("en-GB")} ms, ${operation.budget.provisional ? "provisional" : "measured"}` +
  (operation.budget.excludes.length > 0 ? `, excluding ${Arr.join(operation.budget.excludes, " and ")}` : "") +
  `. Basis: ${operation.budget.basis}.`;

const emits = (operation: Operation) =>
  pipe(
    operation.outcomes,
    Arr.map(
      (outcome) =>
        `${outcome.tag === null ? "" : `${code(outcome.tag)}: `}${list(Arr.map(outcome.emits, (event) => code(event.identifier)))}`,
    ),
    Arr.join("; "),
  );

const section = (name: OperationName, index: number, of: ClaimsOf): string => {
  const operation: Operation = operations[name];
  const lines = [
    `## ${index + 1}. ${code(name)}`,
    "",
    `- Served by: the ${servedBy(name)} group.`,
    `- Refusals: ${list(Arr.map(refusalsOf(operation), (refusal) => code(refusal.identifier)))}, and ${code("NotSignedIn")} from sign-in.`,
    `- Emits: ${emits(operation)}.`,
    `- Budget: ${budget(operation)}`,
    "",
    ...Arr.flatMap(of.claims, (claim, n) => [
      `${n + 1}. ${claim.says}${claim.thinLine ? " *(thin line)*" : ""}`,
      `   - In: ${code(claim.state.name)}.`,
      `   - Observes: ${claim.observes}`,
      ...(claim.refusals.length > 0
        ? [`   - Refusals: ${list(Arr.map(claim.refusals, (refusal) => code(refusal.identifier)))}.`]
        : []),
      ...origin(claim),
    ]),
  ];
  if (of.dropped.length > 0) {
    lines.push("", "Old claims not kept:", "");
    for (const each of of.dropped) lines.push(`- ${code(each.id)}: "${each.was}" Why: ${each.why}`);
  }
  return Arr.join(lines, "\n");
};

const summary = (): string => {
  const rows = Arr.map(Rec.keys(allClaims), (name) => {
    const { claims, dropped } = allClaims[name];
    const by = (kind: string | null) => Arr.filter(claims, (claim) => (claim.origin?.kept ?? null) === kind).length;
    return `| ${code(name)} | ${claims.length} | ${by("word for word")} | ${by("rewritten")} | ${by(null)} | ${dropped.length} |`;
  });
  return Arr.join(
    [
      "| Operation | Claims | Old, word for word | Old, rewritten | New | Old, not kept |",
      "|---|---|---|---|---|---|",
      ...rows,
    ],
    "\n",
  );
};

/** The names of a facts schema's fields. */
const fieldsOf = (facts: unknown): ReadonlyArray<string> =>
  (typeof facts === "object" || typeof facts === "function") &&
  facts !== null &&
  "fields" in facts &&
  typeof facts.fields === "object" &&
  facts.fields !== null
    ? Rec.keys({ ...facts.fields })
    : [];

const worlds = (): string =>
  pipe(
    Rec.values(startingWorlds),
    Arr.map((world) => {
      const from = world.from === null ? "" : ` Made from ${code(world.from.name)}.`;
      const steps = Arr.map(
        world.steps,
        (step) =>
          `${step.operation === "wait" ? "wait" : code(step.operation)} as ${step.as}: ${step.does}` +
          (step.fact === null ? "" : ` (fact ${code(step.fact)})`),
      );
      const added = Arr.filter(fieldsOf(world.facts), (field) => !fieldsOf(world.from?.facts).includes(field));
      return (
        `- ${code(world.name)}.${from} ${world.holds}${steps.length > 0 ? ` Steps: ${Arr.join(steps, "; ")}.` : ""}` +
        ` A journey from it gets it ${world.made === "from its template" ? "from its template" : "made by its steps"}.` +
        (added.length > 0 ? ` Facts it adds: ${Arr.join(Arr.map(added, code), ", ")}.` : "")
      );
    }),
    Arr.join("\n"),
  );

export const renderClaims = (): string =>
  Arr.join(
    [
      header,
      "## Count",
      "",
      summary(),
      "",
      "## Starting worlds",
      "",
      "Declared in `src/starting-worlds.ts`. Each is made through the door from the one before it, then either saved as a template that a journey starting from it gets (the runner's one world reset in place to it), or made by its steps for each journey. A journey reads the facts of its world, and of every world it is made from, with `given` (decisions.md, 38).",
      "",
      worlds(),
      "",
      ...Arr.map(Rec.keys(allClaims), (name, index) => `${section(name, index, allClaims[name])}\n`),
    ],
    "\n",
  );
