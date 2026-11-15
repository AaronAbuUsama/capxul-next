// The machine format (docs/roadmap.md, "Lifecycles are machines in the blueprint", step 3.4): a thing with a
// lifecycle that callers see and refusals depend on is declared once, in its thing's `lifecycle.ts`, as its states, its
// start, and its moves. Each move is made by one operation, sends one event, and names what happens from every state it
// cannot start from: a declared refusal, or "unchanged". Each operation, event and refusal is its declaration itself,
// imported, never its name written as a string (docs/design/blueprint.md, part 7, F7): the thing's states are its
// values' schemas, so the machine imports its verbs, events and refusals and none of them imports the machine. From
// the declaration `make` derives the refusal's `state` field (checked: the type refuses a refused-state schema that
// differs from the states its moves refuse from), the `step` Core moves the thing with, its graph and diagram, and the
// SQL CHECK constraint; `named` reads it with every declaration as its name. Flat: no nested or parallel states and no
// guards that run code. Built from Effect's own parts, not a runtime.
import * as Arr from "effect/Array";
import * as Graph from "effect/Graph";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import type * as Schema from "effect/Schema";

/** An operation that makes a start or a move: its declaration, named by its Rpc's tag. */
export interface Maker {
  readonly rpc: { readonly _tag: string };
}

/** An event sent, or a refusal named: its declaration, named by its tag. */
export interface Tagged {
  readonly identifier: string;
}

/** What a move does from a state it cannot start from: refuse with a declared refusal, or leave it as it is. */
export type Otherwise = { readonly refusal: Tagged } | "unchanged";

/** How a thing comes to be: in `state`, made by the operation `by`, which sends `event`. */
export interface Start<S extends string> {
  readonly state: S;
  readonly by: Maker;
  readonly event: Tagged;
}

/** One move, as declared: from the states `from` to `to`, made by `by`, sending `event`. */
export interface Move<S extends string = string> {
  readonly from: ReadonlyArray<S>;
  readonly to: S;
  readonly by: Maker;
  readonly event: Tagged;
  readonly otherwise: { readonly [state: string]: Otherwise };
}

/**
 * What a move declared as `M` must also be, given the machine's states `S`: its `otherwise` names every state not in
 * `from`, and none in it. A move from every state is not narrowed: it has nothing to name (nor is one whose `to` or
 * `from` is no state, which the constraint on its moves already refuses).
 */
type Fitting<S extends string, M extends Move> = [S] extends [M["from"][number]]
  ? unknown
  : {
      readonly otherwise: { readonly [K in Exclude<S, M["from"][number]>]: Otherwise } & {
        readonly [K in M["from"][number]]?: never;
      };
    };

/** The states a move declared as `M` refuses from, and the refusals it names. */
type RefusingOf<M extends Move> = {
  readonly [K in keyof M["otherwise"]]: M["otherwise"][K] extends { readonly refusal: Tagged } ? K : never;
}[keyof M["otherwise"]] &
  string;
type RefusalOf<M extends Move> = Extract<M["otherwise"][keyof M["otherwise"]], { readonly refusal: Tagged }>["refusal"];
type UnchangedOf<M extends Move> = {
  readonly [K in keyof M["otherwise"]]: M["otherwise"][K] extends "unchanged" ? K : never;
}[keyof M["otherwise"]] &
  string;

/** `Case`, unless no state leads to it (`From` is never). */
type Unless<From, Case> = [From] extends [never] ? never : Case;

/** What `step` answers for one move: the move made, nothing to do, or the declared refusal; only what can happen. */
export type Stepped<M extends Move> =
  | { readonly _tag: "Moved"; readonly to: M["to"]; readonly event: M["event"] }
  | Unless<UnchangedOf<M>, { readonly _tag: "Unchanged"; readonly state: UnchangedOf<M> }>
  | Unless<RefusingOf<M>, { readonly _tag: "Refused"; readonly refusal: RefusalOf<M>; readonly state: RefusingOf<M> }>;

/** What `step` answers for any move of any machine. */
export type AnyStepped =
  | { readonly _tag: "Moved"; readonly to: string; readonly event: Tagged }
  | { readonly _tag: "Unchanged"; readonly state: string }
  | { readonly _tag: "Refused"; readonly refusal: Tagged; readonly state: string };

/** The states some move of `Moves` refuses from. */
export type RefusedOf<Moves extends { readonly [move: string]: Move }> = {
  readonly [Name in keyof Moves]: RefusingOf<Moves[Name]>;
}[keyof Moves];

export interface Machine<
  Name extends string,
  Key extends string,
  States extends ReadonlyArray<string>,
  First extends States[number],
  Moves extends { readonly [move: string]: Move },
  Refused extends ReadonlyArray<string> = ReadonlyArray<RefusedOf<Moves>>,
> {
  readonly name: Name;
  /** The field naming the thing, which every event of its start and moves and every refusal of its moves carries. */
  readonly key: Key;
  /** Its states, in the order declared. */
  readonly states: States;
  readonly start: Start<First>;
  readonly moves: Moves;
  /** The schema of its state: exactly its states, its thing's values' schema. */
  readonly State: Schema.Literals<States>;
  /** The states some move is refused from, in the order declared: what a refusal's `state` field may name. */
  readonly refusedStates: ReadonlyArray<RefusedOf<Moves>>;
  /** Their schema, its thing's values' schema, which its closing refusal's `state` field is. */
  readonly RefusedState: Schema.Literals<Refused>;
  /** Its states, and one edge per move per state it starts from, carrying the move's name. */
  readonly graph: Graph.DirectedGraph<States[number], string>;
  /** The graph as a Mermaid state diagram, for its thing's page. */
  readonly diagram: string;
  /** What `move` does from `state`. Core moves the thing through this and nothing else. */
  step<Named extends keyof Moves & string>(state: States[number], move: Named): Stepped<Moves[Named]>;
  /** The SQL CHECK constraint on `column` that refuses any state the machine does not have. */
  check(column: string): string;
}

/**
 * Nothing when `Given`, the states a refused-state schema names, are exactly `Wanted`, those the moves refuse from;
 * otherwise a field no schema has, naming the difference, so the declaration does not compile.
 */
type Exactly<Given, Wanted> = [Given] extends [Wanted]
  ? [Wanted] extends [Given]
    ? unknown
    : { readonly "refused misses states its moves refuse from": Exclude<Wanted, Given> }
  : { readonly "refused names states no move refuses from": Exclude<Given, Wanted> };

/**
 * Builds a machine from its declaration; the type refuses a move whose `otherwise` misses or repeats a state, and a
 * `refused` schema that is not exactly the states its moves refuse from.
 */
export const make = <
  const Name extends string,
  const Key extends string,
  const States extends ReadonlyArray<string>,
  const First extends NoInfer<States[number]>,
  const Moves extends { readonly [move: string]: Move<NoInfer<States[number]>> },
  const Refused extends ReadonlyArray<NoInfer<States[number]>>,
>(declaration: {
  readonly name: Name;
  readonly key: Key;
  /** Its states, in order: its thing's values' schema of them. */
  readonly states: Schema.Literals<States>;
  /** The states some move refuses from, in order: its thing's values' schema of them. */
  readonly refused: Schema.Literals<Refused> & Exactly<Refused[number], NoInfer<RefusedOf<Moves>>>;
  readonly start: Start<First>;
  readonly moves: { readonly [Named in keyof Moves]: Moves[Named] & Fitting<NoInfer<States[number]>, Moves[Named]> };
}): Machine<Name, Key, States, First, Moves, Refused> => {
  type S = States[number];
  const { name, key, start } = declaration;
  const State: Schema.Literals<States> = declaration.states;
  const RefusedState: Schema.Literals<Refused> = declaration.refused;
  const states = State.literals;
  const moves: Moves = declaration.moves;
  const entries = Rec.toEntries<string, Move>(moves);
  const refusedStates = Arr.filter(states, (state): state is RefusedOf<Moves> & S =>
    Arr.some(entries, ([, move]) => {
      const otherwise = move.otherwise[state];
      return otherwise !== undefined && otherwise !== "unchanged";
    }),
  );
  const graph = Graph.directed<S, string>((mutable) => {
    const index = new Map<string, Graph.NodeIndex>(Arr.map(states, (state) => [state, Graph.addNode(mutable, state)]));
    for (const [named, move] of entries)
      for (const from of move.from) {
        const source = index.get(from);
        const target = index.get(move.to);
        if (source !== undefined && target !== undefined) Graph.addEdge(mutable, source, target, named);
      }
  });
  const nameOf = (node: Graph.NodeIndex) => Option.getOrElse(Graph.getNode(graph, node), () => "");
  const arrows = Arr.map(
    graph.pipe(Graph.edges, Graph.values, Arr.fromIterable),
    (edge) => `    ${nameOf(edge.source)} --> ${nameOf(edge.target)}: ${edge.data}`,
  );
  function step<Named extends keyof Moves & string>(state: S, move: Named): Stepped<Moves[Named]>;
  function step(state: string, move: string): AnyStepped {
    const declared: Move | undefined = moves[move];
    if (declared === undefined) return { _tag: "Unchanged", state };
    if (Arr.contains(declared.from, state)) return { _tag: "Moved", to: declared.to, event: declared.event };
    const otherwise = declared.otherwise[state];
    return otherwise === undefined || otherwise === "unchanged"
      ? { _tag: "Unchanged", state }
      : { _tag: "Refused", refusal: otherwise.refusal, state };
  }
  return {
    name,
    key,
    states,
    start,
    moves,
    State,
    refusedStates,
    RefusedState,
    graph,
    diagram: Arr.join(["stateDiagram-v2", `    [*] --> ${start.state}`, ...arrows], "\n"),
    step,
    check: (column) =>
      `check (${column} in (${Arr.join(
        Arr.map(states, (state) => `'${state}'`),
        ", ",
      )}))`,
  };
};

/** A start or a move with each declaration as its name: what a check, a page or a database reads. */
export interface NamedMove {
  readonly from: ReadonlyArray<string>;
  readonly to: string;
  readonly by: string;
  readonly event: string;
  readonly otherwise: { readonly [state: string]: { readonly refusal: string } | "unchanged" };
}

/** A machine with each declaration as its name. */
export interface NamedMachine {
  readonly name: string;
  readonly key: string;
  readonly states: ReadonlyArray<string>;
  readonly start: { readonly state: string; readonly by: string; readonly event: string };
  readonly moves: { readonly [move: string]: NamedMove };
  readonly diagram: string;
}

/** What any machine shows, as `named` reads it. */
export interface Declared {
  readonly name: string;
  readonly key: string;
  readonly states: ReadonlyArray<string>;
  readonly start: Start<string>;
  readonly moves: { readonly [move: string]: Move };
  readonly diagram: string;
}

/** The name of the operation that makes a start or a move. */
export const madeBy = (made: { readonly by: Maker }): string => made.by.rpc._tag;

/** `machine`, each operation, event and refusal it holds read as its name. */
export const named = (machine: Declared): NamedMachine => ({
  name: machine.name,
  key: machine.key,
  states: machine.states,
  start: { state: machine.start.state, by: madeBy(machine.start), event: machine.start.event.identifier },
  moves: Rec.map(machine.moves, (move) => ({
    from: move.from,
    to: move.to,
    by: madeBy(move),
    event: move.event.identifier,
    otherwise: Rec.map(move.otherwise, (then) => (then === "unchanged" ? then : { refusal: then.refusal.identifier })),
  })),
  diagram: machine.diagram,
});
