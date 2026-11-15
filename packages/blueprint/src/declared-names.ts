// Every name the blueprint declares, in one set: each operation's name, each refusal's tag, the tag of each event
// and of each kind of success an operation declares, and each starting world's name. The lint rule
// capxul/declared-names (packages/lint) reads it, so a name written again as a string elsewhere is found.
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import { refusals } from "./errors.ts";
import type { Operation } from "./operation.ts";
import { startingWorlds } from "./starting-worlds.ts";

/** The declared names, given every operation by its name. */
export const namesOf = (operations: { readonly [name: string]: Operation }): ReadonlySet<string> =>
  new Set([
    ...Rec.keys(operations),
    ...Rec.keys(refusals),
    ...Arr.map(Rec.values(startingWorlds), (world) => world.name),
    ...Arr.flatMap(Rec.values(operations), (operation) => Arr.map(operation.emits, (event) => event.identifier)),
    ...Arr.flatMap(Rec.values(operations), (operation) =>
      Arr.flatMap(operation.outcomes, (outcome) => (outcome.tag === null ? [] : [outcome.tag])),
    ),
  ]);
