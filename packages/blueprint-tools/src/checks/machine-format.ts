// The machine format, as the delta check reads it (docs/roadmap.md, "Typed once, by check", step 3.5): an operation
// meets it when it starts or moves some machine (../language/lifecycle.ts) and every move it makes declares what
// happens from every state it cannot start from, each refusal one the operation declares; or when its verb declares it
// stateless, with a reason. Written as a check, by another agent than the one who classifies the operations: the list
// of operations allowed to lack it today is `unmigrated`, in formats.ts, not here. Pure: formats.ts gives it the
// blueprint's domains.
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import * as Str from "effect/String";
import type { Format, Stray } from "./format.ts";
import type { Otherwise } from "../language/lifecycle.ts";

/** A machine, as far as the format reads it. */
export interface MachineShape {
  readonly name: string;
  readonly states: ReadonlyArray<string>;
  readonly start: { readonly by: string };
  readonly moves: {
    readonly [move: string]: {
      readonly from: ReadonlyArray<string>;
      readonly by: string;
      readonly otherwise: { readonly [state: string]: Otherwise };
    };
  };
}

/** One domain, as far as the format reads it: its operations, each with the tags of the refusals it declares. */
export interface DomainShape {
  readonly operations: { readonly [operation: string]: ReadonlyArray<string> };
  readonly machines: { readonly [machine: string]: MachineShape };
  /** Each operation that moves no thing with a lifecycle, with why. Undefined when its domain exports none. */
  readonly stateless: { readonly [operation: string]: string } | undefined;
}

/** Every domain, by its folder. */
export type Declared = { readonly [domain: string]: DomainShape };

/** What `move` of `machine`, made by an operation declaring `refusals`, fails to declare. */
const movesFaults = (
  machine: MachineShape,
  name: string,
  move: MachineShape["moves"][string],
  refusals: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const where = `${machine.name}.${name}`;
  const named = Rec.keys(move.otherwise);
  return [
    ...Arr.flatMap(machine.states, (state) =>
      Arr.contains(move.from, state) || Arr.contains(named, state)
        ? []
        : [`${where} declares nothing from ${state}: name its refusal or "unchanged" in \`otherwise\``],
    ),
    ...Arr.flatMap(named, (state) => [
      ...(Arr.contains(move.from, state) ? [`${where} names ${state} both in \`from\` and in \`otherwise\``] : []),
      ...(Arr.contains(machine.states, state) ? [] : [`${where} names ${state} in \`otherwise\`, no state of it`]),
    ]),
    ...Arr.flatMap(Rec.toEntries(move.otherwise), ([state, otherwise]) =>
      otherwise === "unchanged" || Arr.contains(refusals, otherwise.refusal)
        ? []
        : [`${where} refuses from ${state} with ${otherwise.refusal}, which ${move.by} does not declare`],
    ),
  ];
};

/** The machine format over `given`, allowing `unmigrated` to lack it. */
export const machineFormat = <const Name extends string>(
  given: Declared,
  unmigrated: ReadonlyArray<Name>,
): Format<Name> => {
  const every = Rec.toEntries(given);
  const machines = Arr.flatMap(every, ([, domain]) => Rec.values(domain.machines));
  const domainOf = (operation: string) => Arr.findFirst(every, ([, domain]) => Rec.has(domain.operations, operation));
  const missing = (operation: string): ReadonlyArray<string> => {
    const found = domainOf(operation);
    if (found._tag === "None") return [`${operation} is no operation of any domain`];
    const [folder, domain] = found.value;
    const refusals = domain.operations[operation] ?? [];
    const starts = Arr.filter(machines, (machine) => machine.start.by === operation);
    const moves = Arr.flatMap(machines, (machine) =>
      Arr.flatMap(Rec.toEntries(machine.moves), ([name, move]) =>
        move.by === operation ? [{ machine, name, move }] : [],
      ),
    );
    const makes = [
      ...Arr.map(starts, (machine) => `${machine.name}'s start`),
      ...Arr.map(moves, ({ machine, name }) => `${machine.name}.${name}`),
    ];
    const reason = domain.stateless === undefined ? undefined : domain.stateless[operation];
    if (reason !== undefined && makes.length > 0)
      return [`its verb, in the domain ${folder}, declares it stateless, yet it makes ${Arr.join(makes, ", ")}`];
    if (reason !== undefined)
      return Str.trim(reason) === "" ? [`its verb, in the domain ${folder}, declares it stateless with no reason`] : [];
    if (makes.length === 0)
      return [
        `it starts or moves no machine, and its verb (in the domain ${folder}) does not declare it stateless: ` +
          `declare its machine, or its reason in the verb's \`stateless\``,
      ];
    return Arr.flatMap(moves, ({ machine, name, move }) => movesFaults(machine, name, move, refusals));
  };
  const strays = (): ReadonlyArray<Stray> =>
    Arr.flatMap(every, ([folder, domain]) =>
      domain.stateless === undefined
        ? [
            {
              operation: folder,
              reason:
                `the domain ${folder} exports no \`stateless\`: every domain declares one, {} when each of its ` +
                `operations starts or moves a machine`,
            },
          ]
        : Arr.flatMap(Rec.keys(domain.stateless), (operation) =>
            Rec.has(domain.operations, operation)
              ? []
              : [{ operation, reason: `the domain ${folder} declares it stateless, but it is no operation there` }],
          ),
    );
  return { missing, unmigrated, strays };
};
