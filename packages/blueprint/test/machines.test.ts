// Step 3.4's proof: the machine format (the toolkit's lifecycle) and the invitation's lifecycle
// (src/things/invitation/lifecycle.ts). The generic tests run for every machine the door's `machines` holds, so a new
// machine is covered with nothing added here; the invitation's own cases follow. Written before the format, by another agent than its builder (AGENTS.md,
// "How a feature is built"). Run with `pnpm test`.
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import * as Arbitrary from "effect/Arbitrary";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Graph from "effect/Graph";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { Errors, eventNamesOf, machines, operations, People, refusalsOf, type Operation } from "../src/index.ts";
import { Invitation } from "../src/things/invitation/lifecycle.ts";

type Stepped =
  | { readonly _tag: "Moved"; readonly to: string; readonly event: string }
  | { readonly _tag: "Unchanged"; readonly state: string }
  | { readonly _tag: "Refused"; readonly refusal: string; readonly state: string };

/** What every machine shows, as the generic tests read it. */
interface AnyMachine {
  readonly name: string;
  readonly key: string;
  readonly states: ReadonlyArray<string>;
  readonly start: { readonly state: string; readonly by: string; readonly event: string };
  readonly moves: {
    readonly [move: string]: {
      readonly from: ReadonlyArray<string>;
      readonly to: string;
      readonly by: string;
      readonly event: string;
      readonly otherwise: { readonly [state: string]: { readonly refusal: string } | "unchanged" };
    };
  };
  readonly State: Schema.Top;
  readonly refusedStates: ReadonlyArray<string>;
  readonly RefusedState: Schema.Top;
  readonly graph: Graph.Graph<string, unknown>;
  readonly diagram: string;
  step(state: string, move: string): Stepped;
  check(column: string): string;
}

const every: ReadonlyArray<AnyMachine> = Rec.values(machines);
const byName: { readonly [name: string]: Operation } = operations;
const refusals: { readonly [tag: string]: { readonly fields: { readonly [field: string]: Schema.Top } } } =
  Errors.refusals;
const sorted = (items: ReadonlyArray<string>) => Arr.sort(items, Order.String);
const movesOf = (machine: AnyMachine) => Rec.toEntries(machine.moves);
/** Values no machine's state schema may accept: not a string, or no state of any machine. */
const STRANGERS: ReadonlyArray<unknown> = ["", "nope", "PENDING", " pending", 0, null, undefined, {}];

/** The event class `operation` declares under `tag`, if it declares one. */
const eventOf = (operation: string, tag: string) =>
  Arr.findFirst(byName[operation]?.emits ?? [], (event) => event.identifier === tag);

/** Whether `events` is a path the declaration allows: its start's event, then each a move from where it stands. */
const isPath = (machine: AnyMachine, events: ReadonlyArray<string>): boolean => {
  const [first, ...rest] = events;
  if (first !== machine.start.event) return false;
  let state = machine.start.state;
  for (const event of rest) {
    const move = Arr.findFirst(Rec.values(machine.moves), (each) => each.event === event);
    if (Option.isNone(move) || !Arr.contains(move.value.from, state)) return false;
    state = move.value.to;
  }
  return true;
};

test("at least one machine is declared, each under its own name", () => {
  assert.ok(every.length > 0);
  for (const [name, machine] of Rec.toEntries(machines)) assert.equal(machine.name, name);
});

test("every machine's states are distinct, and its start and every move name only them", () => {
  for (const machine of every) {
    assert.ok(machine.states.length > 0, machine.name);
    assert.equal(Arr.dedupe(machine.states).length, machine.states.length, `${machine.name}: a state twice`);
    assert.ok(Arr.contains(machine.states, machine.start.state), `${machine.name}: its start`);
    assert.ok(movesOf(machine).length > 0, `${machine.name}: no moves`);
    for (const [name, move] of movesOf(machine)) {
      assert.ok(move.from.length > 0, `${machine.name}.${name}: from nowhere`);
      for (const state of [...move.from, move.to])
        assert.ok(Arr.contains(machine.states, state), `${machine.name}.${name}: ${state}`);
    }
  }
});

test("every move's `from` and `otherwise` together cover every state exactly once", () => {
  for (const machine of every)
    for (const [name, move] of movesOf(machine)) {
      const covered = [...move.from, ...Rec.keys(move.otherwise)];
      assert.deepEqual(sorted(covered), sorted(machine.states), `${machine.name}.${name}`);
    }
});

test("every state is reachable from the start in `graph`, which holds one edge per move per `from` state", () => {
  for (const machine of every) {
    const graph = machine.graph;
    assert.equal(Graph.nodeCount(graph), machine.states.length, machine.name);
    const nodes = graph.pipe(Graph.nodes, Graph.values, Arr.fromIterable);
    assert.deepEqual(sorted(nodes), sorted(machine.states));
    const indexOf = (state: string) => Option.getOrThrow(Graph.findNode(graph, (node: string) => node === state));
    const start = indexOf(machine.start.state);
    for (const state of machine.states)
      assert.ok(Graph.hasPath(graph, start, indexOf(state)), `${machine.name}: ${state} is unreachable`);
    const nameOf = (index: number) => Option.getOrThrow(Graph.getNode(graph, index));
    const edges = Arr.map(
      graph.pipe(Graph.edges, Graph.values, Arr.fromIterable),
      (edge) => `${nameOf(edge.source)} -> ${nameOf(edge.target)}`,
    );
    const declared = Arr.flatMap(movesOf(machine), ([, move]) => Arr.map(move.from, (from) => `${from} -> ${move.to}`));
    assert.deepEqual(sorted(edges), sorted(declared), machine.name);
  }
});

test("the start and every move are made by a declared operation, whose declared events name theirs", () => {
  for (const machine of every)
    for (const [what, made] of [["start", machine.start] as const, ...movesOf(machine)]) {
      const operation = byName[made.by];
      assert.ok(operation !== undefined, `${machine.name}.${what}: ${made.by} is no operation`);
      assert.ok(Arr.contains(eventNamesOf(operation), made.event), `${machine.name}.${what}: ${made.event}`);
    }
});

test("every event of a machine carries its key, and names one start or move of one machine only", () => {
  const all = Arr.flatMap(every, (machine) => [
    machine.start.event,
    ...Arr.map(movesOf(machine), ([, move]) => move.event),
  ]);
  assert.equal(Arr.dedupe(all).length, all.length, `an event names two starts or moves: ${Arr.join(all, ", ")}`);
  for (const machine of every)
    for (const made of [machine.start, ...Rec.values(machine.moves)]) {
      const event = eventOf(made.by, made.event);
      assert.ok(Option.isSome(event) && machine.key in event.value.fields, `${made.event} carries no ${machine.key}`);
    }
});

test("every refusal a machine names is declared, by the move's operation, and carries the key and the state", () => {
  for (const machine of every)
    for (const [name, move] of movesOf(machine))
      for (const [state, otherwise] of Rec.toEntries(move.otherwise)) {
        if (otherwise === "unchanged") continue;
        const where = `${machine.name}.${name} from ${state}`;
        const refusal = Rec.get(refusals, otherwise.refusal);
        assert.ok(Option.isSome(refusal), `${where}: ${otherwise.refusal} is no refusal`);
        const operation = byName[move.by];
        const declared = operation === undefined ? [] : Arr.map(refusalsOf(operation), (each) => each.identifier);
        assert.ok(Arr.contains(declared, otherwise.refusal), `${where}: ${move.by} does not declare it`);
        const fields = refusal.value.fields;
        assert.ok(fields[machine.key] !== undefined, `${where}: ${otherwise.refusal} carries no ${machine.key}`);
        const carried = fields["state"];
        assert.ok(carried !== undefined && Schema.is(carried)(state), `${where}: ${otherwise.refusal}.state`);
      }
});

test("`step` answers what the declaration says for every state and every move", () => {
  for (const machine of every)
    for (const [name, move] of movesOf(machine))
      for (const state of machine.states) {
        const otherwise = move.otherwise[state];
        const expected: Stepped = Arr.contains(move.from, state)
          ? { _tag: "Moved", to: move.to, event: move.event }
          : otherwise === "unchanged"
            ? { _tag: "Unchanged", state }
            : { _tag: "Refused", refusal: otherwise?.refusal ?? "", state };
        assert.deepEqual({ ...machine.step(state, name) }, expected, `${machine.name}.${name} from ${state}`);
      }
});

test("`State` decodes exactly the states, and `RefusedState` exactly the states some move is refused from", () => {
  for (const machine of every) {
    const refused = Arr.filter(machine.states, (state) =>
      Arr.some(Rec.values(machine.moves), (move) => {
        const otherwise = move.otherwise[state];
        return otherwise !== undefined && otherwise !== "unchanged";
      }),
    );
    assert.deepEqual(machine.refusedStates, refused, machine.name);
    for (const state of machine.states) {
      assert.ok(Schema.is(machine.State)(state), `${machine.name}: ${state}`);
      assert.equal(Schema.is(machine.RefusedState)(state), Arr.contains(refused, state), `${machine.name}: ${state}`);
    }
    for (const stranger of STRANGERS) {
      assert.ok(!Schema.is(machine.State)(stranger), `${machine.name} accepts ${String(stranger)}`);
      assert.ok(!Schema.is(machine.RefusedState)(stranger), `${machine.name} refuses from ${String(stranger)}`);
    }
  }
});

test("`diagram` is a Mermaid state diagram: the start, then one line per move per `from` state", () => {
  for (const machine of every) {
    const lines = Arr.filter(Arr.map(Str.split(machine.diagram, "\n"), Str.trim), (line) => line !== "");
    assert.equal(lines[0], "stateDiagram-v2", machine.name);
    assert.deepEqual(Arr.filter(lines, Str.startsWith("[*]")), [`[*] --> ${machine.start.state}`]);
    const arrows = Arr.filter(lines, (line) => Str.includes("-->")(line) && !Str.startsWith("[*]")(line));
    const declared = Arr.flatMap(movesOf(machine), ([name, move]) =>
      Arr.map(move.from, (from) => `${from} --> ${move.to}: ${name}`),
    );
    assert.deepEqual(sorted(arrows), sorted(declared), machine.name);
  }
});

test("`check` is the SQL constraint naming every state, in declaration order", () => {
  for (const machine of every) {
    const listed = Arr.join(
      Arr.map(machine.states, (state) => `'${state}'`),
      ", ",
    );
    assert.equal(machine.check("state"), `check (state in (${listed}))`);
    assert.equal(machine.check("phase"), `check (phase in (${listed}))`);
  }
});

test("any sequence of moves, applied with `step` from the start, stays in the states and sends a path", async () => {
  for (const machine of every) {
    const names = Arr.map(movesOf(machine), ([name]) => name);
    const sequences = Arbitrary.array(Arbitrary.schema(Schema.Literals(names)), { maxLength: 12 });
    const result = await Effect.runPromise(
      Arbitrary.checkEffect(
        sequences,
        (sequence) => {
          let state = machine.start.state;
          const sent = [machine.start.event];
          for (const move of sequence) {
            const stepped = machine.step(state, move);
            if (stepped._tag === "Moved") {
              sent.push(stepped.event);
              state = stepped.to;
            } else if (stepped.state !== state) return false;
            if (!Arr.contains(machine.states, state)) return false;
          }
          return isPath(machine, sent);
        },
        { runs: 200 },
      ),
    );
    assert.equal(result._tag, "Passed", `${machine.name}: ${Arbitrary.formatCheckFailure(result) ?? ""}`);
  }
});

test("the invitation's machine is as the lead declared it", () => {
  assert.strictEqual(machines.invitation, Invitation);
  assert.equal(Invitation.name, "invitation");
  assert.equal(Invitation.key, "invitation");
  assert.deepEqual(Invitation.states, ["pending", "accepted", "declined"]);
  assert.deepEqual(
    { ...Invitation.start },
    {
      state: "pending",
      by: People.memberInvite.rpc._tag,
      event: People.MemberInvited.identifier,
    },
  );
  assert.deepEqual(sorted(Rec.keys(Invitation.moves)), ["accept", "decline"]);
  const closed = { refusal: Errors.InvitationClosed.identifier };
  assert.deepEqual(Invitation.moves.accept, {
    from: ["pending"],
    to: "accepted",
    by: People.inviteAccept.rpc._tag,
    event: People.InvitationAccepted.identifier,
    otherwise: { accepted: "unchanged", declined: closed },
  });
  assert.deepEqual(Invitation.moves.decline, {
    from: ["pending"],
    to: "declined",
    by: People.inviteDecline.rpc._tag,
    event: People.InvitationDeclined.identifier,
    otherwise: { accepted: closed, declined: closed },
  });
  assert.deepEqual(Invitation.refusedStates, ["accepted", "declined"]);
});

test("the invitation's state and InvitationClosed's state field are derived from its machine", () => {
  assert.strictEqual(People.InvitationState, Invitation.State);
  assert.deepEqual(People.InvitationState.literals, Invitation.states);
  const field: Schema.Top = Errors.InvitationClosed.fields.state;
  assert.strictEqual(field, Invitation.RefusedState);
  for (const state of Invitation.states)
    assert.equal(Schema.is(field)(state), Arr.contains(Invitation.refusedStates, state), state);
  assert.ok(!Schema.is(field)("cancelled"));
});

const MIGRATIONS = new URL("../../core/migrations/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, MIGRATIONS), "utf8");

test("the newest migration on app.invitations adds the machine's CHECK constraint; 0006 is as it was applied", () => {
  const touching = Arr.filter(sorted(readdirSync(MIGRATIONS)), (name) => Str.includes("app.invitations")(read(name)));
  const newest = Arr.last(touching).pipe(Option.getOrThrow);
  assert.notEqual(newest, "0006_people_invitations.sql");
  assert.ok(Str.includes(Invitation.check("state"))(read(newest)), `${newest} lacks ${Invitation.check("state")}`);
  assert.ok(!/check\s*\(/i.test(read("0006_people_invitations.sql")), "0006 was edited: an applied migration is not");
});
