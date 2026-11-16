// The blueprint's generated commands index (packages/blueprint/src/generated/commands.ts): every operation's command,
// `capxul <thing> <verb>`, from its thing's folder and its verb's file as the layout reads them (roadmap item 3.9).
// Pure: main.ts writes it, through blueprint.ts.
import type { Layout, Verb } from "@capxul/blueprint-tools";
import * as Arr from "effect/Array";
import * as Order from "effect/Order";
import * as Str from "effect/String";
import { first, FROM_THINGS, key, record } from "./blueprint-text.ts";

/**
 * Every operation's command, `capxul <thing> <verb>` (docs/design/blueprint.md, part 12, decision 8; roadmap item
 * 3.9): its thing's folder and its verb's file, read from the layout, never from the operation's name.
 */
export const commandsIndex = (layout: Layout): string => {
  const verbs = Arr.sort(
    Arr.flatMap(layout.things, (thing) => thing.verbs),
    Order.mapInput(Str.Order, (verb: Verb) => verb.operation),
  );
  return Arr.join(
    [
      first(FROM_THINGS) +
        "// Every operation's command, `capxul <thing> <verb>` (docs/design/blueprint.md, part 12, decision 8; roadmap\n" +
        "// item 3.9): the folder of its thing and the file of its verb, never its name split at its dots.",
      'import type { OperationName } from "../index.ts";',
      "",
      "/** An operation's command: its thing, then its verb. */",
      "export type CommandPath = readonly [thing: string, verb: string];",
      "",
      "/** Every operation's command, by the operation's name. */",
      `export const commands: { readonly [Name in OperationName]: CommandPath } = ${record(
        Arr.map(verbs, (verb) => [key(verb.operation), `[${key(verb.thing)}, ${key(verb.verb)}]`]),
      )};`,
      "",
    ],
    "\n",
  );
};
