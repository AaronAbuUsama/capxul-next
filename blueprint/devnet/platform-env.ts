// A world as a reinforcement-learning environment: `env reset|step|state|close`. The interface is the usual one (reset, step, observation, reward, done, info) over what already exists: reset is `run create`
// with a seed, a step is one command through the door (or one agent turn), the observation is what the command returned plus what the seat may read, the reward is the change in the scenario's measures,
// done is the scenario's end, and info is the record entries the step produced. What each costs is measured or estimated in docs/design/worlds-platform.md (Numbers, and "As an environment").

import { Schema } from "effect";
import { error_CAPACITY_REACHED, error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_WRONG_STATE } from "../shared/vocabulary.ts";
import { ok, refused } from "../shared/examples.ts";
import { table_command_records } from "./world-data.ts";
import { machine_run, table_run_seats, table_runs, table_scenarios } from "./platform-data.ts";
import { WorldProfile } from "./world-data.ts";
import { B, make, ms, N, Null, S } from "./platform-kit.ts";

const SEAT = "The key that holds the environment's seat: an agent or a learner holding a key.";
const W = { out: "signed-out", empty: "empty-devnet", done: "run-closed", live: "run-live" } as const;
const OUT = { error: error_NOT_AUTHENTICATED, given: W.out, when: "No one is signed in on this machine." } as const;
const Delta = Schema.Struct({ measure: S, before: N, after: N, delta: N, weight: N });
const Observation = Schema.Struct({ output: S, readable: Schema.Array(Schema.Struct({ name: S, text: S })), worldNow: N });
const Info = Schema.Struct({ run: S, entries: Schema.Array(N), refused: B, code: Null(S), step: N });
const StepOut = Schema.Struct({ env: S, observation: Observation, reward: Schema.Struct({ total: N, deltas: Schema.Array(Delta) }), done: B, doneReason: Null(S), info: Info });
const obs = (o: Record<string, unknown> = {}) => ({ output: '{"status":"paid","amount":"1200.00"}', readable: [{ name: "open-bills", text: "3 bills, 2 due within 5 days" }, { name: "budget-room", text: "Finance: 8,800.00 of 10,000.00 left" }], worldNow: ms("2026-03-02T09:00:00Z"), ...o });
const step = (o: Record<string, unknown> = {}) => ({ env: "e_r00051", observation: obs(), reward: { total: 0.5, deltas: [{ measure: "bills-paid-on-time", before: 0.2, after: 0.7, delta: 0.5, weight: 1 }] }, done: false, doneReason: null, info: { run: "r00051", entries: [14], refused: false, code: null, step: 7 }, ...o });

const reset = make({
  id: "env.reset", command: "env reset", title: "Reset: make a fresh environment from a scenario and a seed", rpc: "devnet.env.reset", kind: "action", priority: "critical", cls: "background", p95Ms: 120_000,
  about: "`env reset solo-bit-connect@1 --seed 7 --seat bc-finance --profile core`: makes a run (so a world) from the scenario's template with the seed, starts its stepped clock and returns the first observation. Cost is by profile: `core` restores a 5.5 MB state and starts a lean service (estimate: 1 to 3 seconds; the spike's chain and service start took 1.0 second with stand-in contracts); `full` also restores each company's site (measured: 34 to 42 seconds for one company, 80 seconds for four). Many `core` environments run at once; `full` ones are for evaluation and human runs, not millions of steps.",
  who: SEAT, changes: "One run and its world, live on a stepped clock; a `born` entry.", input: Schema.Struct({ scenario: S, seed: N, seat: S, profile: Null(WorldProfile) }),
  output: Schema.Struct({ env: S, run: S, observation: Observation, info: Info }), reads: [table_scenarios], writes: [table_runs, table_run_seats, table_command_records], drives: [machine_run.t.create],
  claims: [{ claim: "The same scenario, seed and template give the same first observation.", observes: `cli: two \`env reset solo-bit-connect@1 --seed 7\` give equal observations and equal chain state roots.` }, { claim: "A reset is refused when the machine has no room.", observes: `cli: with the machine full, \`env reset\` exits CAPACITY_REACHED.` }],
  refusals: [OUT, { error: error_INVALID_INPUT, given: W.empty, when: "No such scenario, or the seat is not one of its seats." }, { error: error_CAPACITY_REACHED, given: W.empty, when: "No room for another world of this profile." }],
  examples: [ok("Reset the solo scenario", "capxul env reset solo-bit-connect@1 --seed 7 --seat bc-finance --profile core --json", { env: "e_r00051", run: "r00051", observation: obs({ output: "{}", worldNow: ms("2026-03-01T09:00:00Z") }), info: { run: "r00051", entries: [1], refused: false, code: null, step: 0 } }), refused("No room", "capxul env reset solo-bit-connect@1 --seed 8 --seat bc-finance --json", error_CAPACITY_REACHED, {})],
});
export const rpc_devnet_env_reset = reset.rpc;
export const operation_env_reset = reset.op;

const stepOp = make({
  id: "env.step", command: "env step", title: "Step: one command through the door, or one agent turn", rpc: "devnet.env.step", kind: "action", priority: "critical", cls: "write", p95Ms: 3_000,
  about: "`env step --env e_r00051 --command 'payment send …'`: runs one command as the seat, through the same door as any caller (a refusal is a result, not a crash). `--command 'wait 1d'` moves the clock by one plan step, stopping at every due instant. It returns the observation (what the command returned, plus the seat's named reads), the reward (the change in each of the scenario's measures since the last step, weighted, so a learner gets deltas, not totals), whether the run is done and why, and the record entries the step produced. A step takes 0.1 to 0.7 seconds with no clock move (measured: the spike's commands; signing 0.6 s); a one-day move on a `core` world is well under a second (estimate) and on a `full` world seconds (a ten-day move took 33 to 41 seconds for four companies, measured).",
  who: SEAT, changes: "Whatever the command changes in the world; one or more record entries; the measures are scored.", input: Schema.Struct({ env: S, command: S }), output: StepOut,
  reads: [table_runs], writes: [table_command_records],
  claims: [{ claim: "A step returns the observation, the reward as deltas, done and the entries it produced, and a refused command is a result.", observes: `cli: \`env step --command 'payment send …'\` over budget prints refused true, code OVER_BUDGET, a reward of 0 and the refusal's entry seq; a paid one prints a positive delta for the measure it moved.` }, { claim: "The step's entries are exactly the record's new lines.", observes: `cli: the entries listed in info equal the record's lines added since the previous step.` }],
  refusals: [OUT, { error: error_INVALID_INPUT, given: W.empty, when: "No such environment." }, { error: error_WRONG_STATE, given: W.done, when: "The environment is done: reset it." }],
  examples: [ok("Pay a bill", "capxul env step --env e_r00051 --command 'payment send --to brightside --amount 1200' --json", step()), ok("The last day", "capxul env step --env e_r00051 --command 'wait 1d' --json", step({ done: true, doneReason: "end", reward: { total: 0, deltas: [] }, info: { run: "r00051", entries: [97, 98], refused: false, code: null, step: 31 } })), refused("The environment is done", "capxul env step --env e_r00051 --command 'wait 1d' --json", error_WRONG_STATE, { state: "closed" })],
});
export const rpc_devnet_env_step = stepOp.rpc;
export const operation_env_step = stepOp.op;

const state = make({
  id: "env.state", command: "env state", title: "Read an environment's state without stepping", rpc: "devnet.env.state", kind: "query", priority: "normal",
  about: "The current observation, the measures' current values, the step number and whether the environment is done. No clock moves and no entry is written beyond the read.", who: SEAT, changes: "Nothing: it only reads.",
  input: Schema.Struct({ env: S }), output: Schema.Struct({ env: S, observation: Observation, measures: Schema.Array(Schema.Struct({ measure: S, value: N })), step: N, done: B }), reads: [table_runs],
  claims: [{ claim: "Reading the state changes nothing.", observes: `cli: \`env state\` twice returns equal answers and the record gains no entry.` }],
  refusals: [OUT, { error: error_INVALID_INPUT, given: W.empty, when: "No such environment." }], examples: [ok("The state", "capxul env state --env e_r00051 --json", { env: "e_r00051", observation: obs(), measures: [{ measure: "bills-paid-on-time", value: 0.7 }], step: 7, done: false })],
});
export const rpc_devnet_env_state = state.rpc;
export const operation_env_state = state.op;

const close = make({
  id: "env.close", command: "env close", title: "Close an environment", rpc: "devnet.env.close", kind: "action", priority: "normal", cls: "background", p95Ms: 30_000,
  about: "Ends an environment: the run is closed, and its world is destroyed (`--keep` parks it and keeps the dataset). Training loops close thousands; a `core` world frees its memory at once.", who: SEAT, changes: "The run is closed; the world is destroyed or parked.",
  input: Schema.Struct({ env: S, keep: B }), output: Schema.Struct({ env: S, run: S, kept: B }), reads: [table_runs], writes: [table_runs],
  claims: [{ claim: "A closed environment frees its world.", observes: `cli: \`env close --env e_r00051\` then \`world list\` no longer lists r00051 (or lists it parked with --keep).` }],
  refusals: [OUT, { error: error_INVALID_INPUT, given: W.empty, when: "No such environment." }], examples: [ok("Close", "capxul env close --env e_r00051 --json", { env: "e_r00051", run: "r00051", kept: false })],
});
export const rpc_devnet_env_close = close.rpc;
export const operation_env_close = close.op;
