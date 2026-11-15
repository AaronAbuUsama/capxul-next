// The machine format (docs/roadmap.md, "Lifecycles are machines in the blueprint", step 3.4): a thing with a
// lifecycle that callers see and refusals depend on is declared once, in its domain's `machines.ts`, as its states, its
// start, and its moves. Each move is made by one operation, sends one event, and names what happens from every state it
// cannot start from: a declared refusal, or "unchanged". From the declaration `make` derives the state schema, the
// refusal's `state` field, the `step` Core moves the thing with, its graph and diagram, and the SQL CHECK constraint.
// Flat: no nested or parallel states and no guards that run code. Built from Effect's own parts, not a runtime.
import * as Arr from "effect/Array";
import * as Graph from "effect/Graph";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";

/** What a move does from a state it cannot start from: refuse with a declared refusal, or leave it as it is. */
export type Otherwise = { readonly refusal: string } | "unchanged";

/** How a thing comes to be: in `state`, made by the operation `by`, which sends `event`. */
export interface Start<S extends string> {
  readonly state: S;
  readonly by: string;
  readonly event: string;
}

/** One move, as declared: from the states `from` to `to`, made by `by`, sending `event`. */
export interface Move<S extends string = string> {
  readonly from: ReadonlyArray<S>;
  readonly to: S;
  readonly by: string;
  readonly event: string;
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
  readonly [K in keyof M["otherwise"]]: M["otherwise"][K] extends { readonly refusal: string } ? K : never;
}[keyof M["otherwise"]] &
  string;
type RefusalOf<M extends Move> = Extract<M["otherwise"][keyof M["otherwise"]], { readonly refusal: string }>["refusal"];
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
  | { readonly _tag: "Moved"; readonly to: string; readonly event: string }
  | { readonly _tag: "Unchanged"; readonly state: string }
  | { readonly _tag: "Refused"; readonly refusal: string; readonly state: string };

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
> {
  readonly name: Name;
  /** The field naming the thing, which every event of its start and moves and every refusal of its moves carries. */
  readonly key: Key;
  /** Its states, in the order declared. */
  readonly states: States;
  readonly start: Start<First>;
  readonly moves: Moves;
  /** The schema of its state: exactly its states. */
  readonly State: Schema.Literals<States>;
  /** The states some move is refused from, in the order declared: what a refusal's `state` field may name. */
  readonly refusedStates: ReadonlyArray<RefusedOf<Moves>>;
  readonly RefusedState: Schema.Literals<ReadonlyArray<RefusedOf<Moves>>>;
  /** Its states, and one edge per move per state it starts from, carrying the move's name. */
  readonly graph: Graph.DirectedGraph<States[number], string>;
  /** The graph as a Mermaid state diagram, for its domain's claims.md. */
  readonly diagram: string;
  /** What `move` does from `state`. Core moves the thing through this and nothing else. */
  step<Named extends keyof Moves & string>(state: States[number], move: Named): Stepped<Moves[Named]>;
  /** The SQL CHECK constraint on `column` that refuses any state the machine does not have. */
  check(column: string): string;
}

/** Builds a machine from its declaration; the type refuses a move whose `otherwise` misses or repeats a state. */
export const make = <
  const Name extends string,
  const Key extends string,
  const States extends ReadonlyArray<string>,
  const First extends NoInfer<States[number]>,
  const Moves extends { readonly [move: string]: Move<NoInfer<States[number]>> },
>(declaration: {
  readonly name: Name;
  readonly key: Key;
  readonly states: States;
  readonly start: Start<First>;
  readonly moves: { readonly [Named in keyof Moves]: Moves[Named] & Fitting<NoInfer<States[number]>, Moves[Named]> };
}): Machine<Name, Key, States, First, Moves> => {
  type S = States[number];
  const { name, key, states, start } = declaration;
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
    State: Schema.Literals(states),
    refusedStates,
    RefusedState: Schema.Literals(refusedStates),
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
