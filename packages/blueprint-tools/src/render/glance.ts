// Renders the four lists a thing's page opens with (docs/design/blueprint.md, part 13, amended 15 November 2026): its
// commands, its SDK calls, the refusals its verbs answer with each one's exit code, and the events they send. Names
// are today's operation names: a command is the name split at its dots, an SDK call the client's function of that
// name. Work no door serves has no command and no call, so it adds nothing here. A refusal's exit code is read from
// its own declaration (`refusal(...)`). Pure: render.ts places it.
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Str from "effect/String";
import * as Predicate from "effect/Predicate";
import { eventNamesOf, refusalsOf, type EventClass, type Operation } from "../language/operation.ts";

const code = (text: string) => `\`${text}\``;
const bullets = (items: ReadonlyArray<string>): ReadonlyArray<string> =>
  items.length === 0 ? ["- none"] : Arr.map(items, (item) => `- ${item}`);

/** How a refusal's exit code reads: the code its declaration carries (`refusal(...)`). */
const exitOf = (refusal: EventClass | undefined): string =>
  Option.match(
    Option.liftPredicate(Predicate.isNumber)(refusal === undefined ? undefined : Reflect.get(refusal, "exitCode")),
    {
      onNone: () => "no exit code declared",
      onSome: (each) => `exit ${String(each)}`,
    },
  );

/** The opening lists of a thing's page, for its operations (of `operations`) in the order of `names`. */
export const glanceSection = (
  operations: { readonly [name: string]: Operation },
  every: { readonly [tag: string]: EventClass },
  names: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const exit = (tag: string): string => exitOf(every[tag]);
  const of: ReadonlyArray<Operation> = Arr.flatMap(names, (name) =>
    Option.toArray(Option.fromNullishOr(operations[name])),
  );
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
