// Renders the four lists a thing's page opens with (docs/design/blueprint.md, part 13, amended 15 November 2026): its
// commands, its SDK calls, the refusals its verbs answer with each one's exit code, and the events they send. Names
// are today's operation names: a command is the name split at its dots, an SDK call the client's function of that
// name. Work no door serves has no command and no call, so it adds nothing here. Pure: render.ts places it.
import { Errors, operations, type OperationName } from "../../../blueprint/src/index.ts";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Str from "effect/String";
import { eventNamesOf, refusalsOf, type Operation } from "../language/operation.ts";

const code = (text: string) => `\`${text}\``;
const bullets = (items: ReadonlyArray<string>): ReadonlyArray<string> =>
  items.length === 0 ? ["- none"] : Arr.map(items, (item) => `- ${item}`);

/** The command line's exit code for each refusal, by its tag. */
const exitCodes: { readonly [tag: string]: number } = Errors.exitCode;

const exit = (tag: string): string =>
  Option.match(Option.fromNullishOr(exitCodes[tag]), {
    onNone: () => "no exit code declared",
    onSome: (each) => `exit ${String(each)}`,
  });

/** The opening lists of a thing's page, for its operations in the order of `operations`. */
export const glanceSection = (names: ReadonlyArray<OperationName>): ReadonlyArray<string> => {
  const of: ReadonlyArray<Operation> = Arr.map(names, (name) => operations[name]);
  const refusals = Arr.dedupe(
    Arr.flatMap(of, (operation) => Arr.map(refusalsOf(operation), (each) => each.identifier)),
  );
  const events = Arr.dedupe(Arr.flatMap(of, eventNamesOf));
  return [
    "## At a glance",
    "",
    "Commands:",
    "",
    ...bullets(Arr.map(names, (name) => code(`capxul ${Arr.join(Str.split(name, "."), " ")}`))),
    "",
    "SDK calls:",
    "",
    ...bullets(Arr.map(names, (name) => code(`capxul["${name}"]`))),
    "",
    names.length === 0
      ? "Refusals, with their exit codes:"
      : `Refusals, with their exit codes (every call can also be refused by sign-in, ${code("NotSignedIn")}, ${exit("NotSignedIn")}):`,
    "",
    ...bullets(Arr.map(refusals, (tag) => `${code(tag)}, ${exit(tag)}`)),
    "",
    "Events:",
    "",
    ...bullets(Arr.map(events, code)),
    "",
  ];
};
