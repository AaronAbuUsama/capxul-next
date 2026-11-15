// Every name the blueprint declares, in one set: each operation's name, each refusal's tag, the tag of each event
// and of each kind of success an operation declares, and each starting world's name. The blueprint gathers its own
// (`declaredNames`, packages/blueprint src/index.ts), which the lint rule capxul/declared-names (packages/lint) reads,
// so a name written again as a string elsewhere is found. Pure: it is given the blueprint's declarations.
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import type { Operation } from "../language/operation.ts";

/** The declared names, given every operation and every refusal by its name, and every starting world. */
export const namesOf = (
  operations: { readonly [name: string]: Operation },
  refusals: { readonly [tag: string]: unknown },
  startingWorlds: { readonly [world: string]: { readonly name: string } },
): ReadonlySet<string> =>
  new Set([
    ...Rec.keys(operations),
    ...Rec.keys(refusals),
    ...Arr.map(Rec.values(startingWorlds), (world) => world.name),
    ...Arr.flatMap(Rec.values(operations), (operation) => Arr.map(operation.emits, (event) => event.identifier)),
    ...Arr.flatMap(Rec.values(operations), (operation) =>
      Arr.flatMap(operation.outcomes, (outcome) => (outcome.tag === null ? [] : [outcome.tag])),
    ),
  ]);
