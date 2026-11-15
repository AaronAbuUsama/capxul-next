// Renders a thing's lifecycle (the format is ../language/lifecycle.ts) into its page: its states, start and moves, and
// its diagram, generated from the declaration, never typed. Pure: render.ts places it.
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import type * as Machine from "../language/lifecycle.ts";

/** A machine as rendered: what every machine shows. */
interface Shown {
  readonly name: string;
  readonly key: string;
  readonly states: ReadonlyArray<string>;
  readonly start: Machine.Start<string>;
  readonly moves: { readonly [move: string]: Machine.Move };
  readonly diagram: string;
}

const code = (text: string) => `\`${text}\``;
const codes = (items: ReadonlyArray<string>) => Arr.join(Arr.map(items, code), ", ");

const otherwise = (move: Machine.Move): string =>
  Arr.join(
    Arr.map(
      Rec.toEntries(move.otherwise),
      ([state, then]) => `${code(state)}: ${then === "unchanged" ? "unchanged" : `refused, ${code(then.refusal)}`}`,
    ),
    "; ",
  );

const machine = (shown: Shown): string =>
  Arr.join(
    [
      `### ${code(shown.name)}`,
      "",
      `- States: ${codes(shown.states)}. Its ${code(shown.key)} field names it in each event and refusal below.`,
      `- Starts ${code(shown.start.state)}, made by ${code(shown.start.by)}, which sends ${code(shown.start.event)}.`,
      "",
      "| Move | From | To | Made by | Sends | From any other state |",
      "|---|---|---|---|---|---|",
      ...Arr.map(
        Rec.toEntries(shown.moves),
        ([name, move]) =>
          `| ${code(name)} | ${codes(move.from)} | ${code(move.to)} | ${code(move.by)} | ${code(move.event)} | ${otherwise(move)} |`,
      ),
      "",
      "```mermaid",
      shown.diagram,
      "```",
      "",
    ],
    "\n",
  );

/** The section of a thing's page for its lifecycle; none when it has none. */
export const machinesSection = (machines: { readonly [name: string]: Shown }): ReadonlyArray<string> => {
  const every = Rec.values(machines);
  if (every.length === 0) return [];
  return [
    "## Machines",
    "",
    "Declared in the thing's `lifecycle.ts` (the format is the toolkit's). Core moves each thing only through its machine's",
    "`step`, the database refuses a state the machine does not have, and the runner checks that each thing's events",
    "form a path through it.",
    "",
    ...Arr.map(every, machine),
  ];
};
