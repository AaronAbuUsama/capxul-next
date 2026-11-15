// The names the blueprint declares, as a journey writes them: `named["doc.create"]`, `named["InsufficientBalance"]`,
// `named["Held"]`. Each is a computed member the compiler checks against the declarations, so a renamed operation,
// refusal or outcome fails to compile where a journey names it, and no copy of a name is left behind as a string
// (AGENTS.md, `capxul/declared-names`). Journeys written before this file write the names as strings; they are on
// that rule's list (packages/lint/src/unmigrated.ts).
import { declaredNames, type Errors, type OperationName } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import type { Success } from "../client.ts";

/** What a successful call of each operation may answer, by the tag of its kind. */
type Kind = {
  readonly [N in OperationName]: Success<N> extends { readonly _tag: infer T extends string } ? T : never;
}[OperationName];

/** Every name a journey says: an operation, a refusal's tag or the tag of a success's kind. */
type Name = OperationName | Errors.RefusalTag | Kind;

/** Each declared name, keyed by itself. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- each entry is a declared name keyed by itself; the compiler cannot follow an object built from a set
export const named = Rec.fromEntries(
  Arr.map(Arr.fromIterable(declaredNames), (name) => [name, name] as const),
) as unknown as {
  readonly [K in Name]: K;
};
