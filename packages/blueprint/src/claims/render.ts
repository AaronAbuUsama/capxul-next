// Renders claims.md from the declarations: the claims, the starting worlds and each operation's refusals, events
// and budget. Pure: `render.entry.ts` writes the file, and a test compares it with this.
import { operations, servedBy, type OperationName } from "../door.ts";
import { refusalsOf, type Operation } from "../operation.ts";
import { startingWorlds } from "../starting-worlds.ts";
import { allClaims } from "./all.ts";
import type { Claim, ClaimsOf } from "./claim.ts";

const code = (text: string) => `\`${text}\``;
const list = (items: ReadonlyArray<string>) => (items.length === 0 ? "none" : items.join(", "));

const header = `# Acceptance claims of the thin line

Rendered from \`src/<concept>/claims.ts\` and the declarations by \`pnpm claims\`. Do not edit it by hand: a test fails
when this file and its sources differ.

Each claim is proved black-box by a scenario: from its starting world, through the door, reading only what the
operations answer and what the world's door shows of its chain. "Old" names the claim of the old blueprint
(\`docs/thin-line/operations.json\`, its \`evalId\`) it keeps, word for word or rewritten.

## What the runner checks on every call

These hold for every call of every scenario, so no claim repeats them:

1. A successful call emits exactly the events its outcome declares, each once, each carrying exactly what the
   declaration computes from the call's payload and answer, and nothing more. A refused call emits none.
2. A refusal is one the operation declares.
3. The call's spans are recorded under the trace id the caller sent, the first named after the operation.
4. The server's time for the call is within the operation's budget; the time is stored with the run.
`;

const origin = (claim: Claim): ReadonlyArray<string> => {
  if (claim.origin === null) return ["   - Old: none; this claim is new."];
  if (claim.origin.kept === "word for word") return [`   - Old: ${code(claim.origin.id)}, kept word for word.`];
  return [`   - Old: ${code(claim.origin.id)}, rewritten. It said: "${claim.origin.was}" Why: ${claim.origin.why}`];
};

const budget = (operation: Operation) =>
  `${operation.budget.ms.toLocaleString("en-GB")} ms, ${operation.budget.provisional ? "provisional" : "measured"}` +
  (operation.budget.excludes.length > 0 ? `, excluding ${operation.budget.excludes.join(" and ")}` : "") +
  `. Basis: ${operation.budget.basis}.`;

const emits = (operation: Operation) =>
  operation.outcomes
    .map((outcome) => `${outcome.tag === null ? "" : `${code(outcome.tag)}: `}${list(outcome.emits.map((event) => code(event.identifier)))}`)
    .join("; ");

const section = (name: OperationName, index: number, of: ClaimsOf): string => {
  const operation: Operation = operations[name];
  const lines = [
    `## ${index + 1}. ${code(name)}`,
    "",
    `- Served by: the ${servedBy(name)} group.`,
    `- Refusals: ${list(refusalsOf(operation).map((refusal) => code(refusal.identifier)))}, and ${code("NotSignedIn")} from sign-in.`,
    `- Emits: ${emits(operation)}.`,
    `- Budget: ${budget(operation)}`,
    "",
    ...of.claims.flatMap((claim, n) => [
      `${n + 1}. ${claim.says}${claim.thinLine ? " *(thin line)*" : ""}`,
      `   - Given: ${code(claim.given.name)}.`,
      `   - Observes: ${claim.observes}`,
      ...(claim.refusals.length > 0 ? [`   - Refusals: ${list(claim.refusals.map((refusal) => code(refusal.identifier)))}.`] : []),
      ...origin(claim),
    ]),
  ];
  if (of.dropped.length > 0) {
    lines.push("", "Old claims not kept:", "");
    for (const each of of.dropped) lines.push(`- ${code(each.id)}: "${each.was}" Why: ${each.why}`);
  }
  return lines.join("\n");
};

const summary = (): string => {
  const rows = (Object.keys(allClaims) as Array<OperationName>).map((name) => {
    const { claims, dropped } = allClaims[name];
    const by = (kind: string | null) => claims.filter((claim) => (claim.origin?.kept ?? null) === kind).length;
    return `| ${code(name)} | ${claims.length} | ${by("word for word")} | ${by("rewritten")} | ${by(null)} | ${dropped.length} |`;
  });
  return ["| Operation | Claims | Old, word for word | Old, rewritten | New | Old, not kept |", "|---|---|---|---|---|---|", ...rows].join("\n");
};

const worlds = (): string =>
  Object.values(startingWorlds)
    .map((world) => {
      const from = world.from === null ? "" : ` Made from ${code(world.from.name)}.`;
      const steps = world.steps.map((step) => `${step.operation === "wait" ? "wait" : code(step.operation)} as ${step.as}: ${step.does}`);
      return `- ${code(world.name)}.${from} ${world.holds}${steps.length > 0 ? ` Steps: ${steps.join("; ")}.` : ""}`;
    })
    .join("\n");

export const renderClaims = (): string =>
  [
    header,
    "## Count",
    "",
    summary(),
    "",
    "## Starting worlds",
    "",
    "Declared in `src/starting-worlds.ts`. Each is made through the door from the one before it.",
    "",
    worlds(),
    "",
    ...(Object.keys(allClaims) as Array<OperationName>).map((name, index) => `${section(name, index, allClaims[name])}\n`),
  ].join("\n");
