// Clean data: a closed run is checked, exported as one dataset, accepted or rejected, and archived. `run check|export|accept|archive|redact`. The run's manifest says exactly what produced the data;
// the entries are the record's own (table command-records, schema 1 from the spike). Testers are real people: consent is explicit, secrets are never in the data, and a person's name is a pseudonym.
// See docs/design/worlds-platform.md, "Clean data".

import { Schema } from "effect";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE } from "../shared/vocabulary.ts";
import { ok, refused } from "../shared/examples.ts";
import { machine_run, table_run_datasets, table_run_seats, table_runs, table_world_members } from "./platform-data.ts";
import { table_command_records } from "./world-data.ts";
import { B, CheckLine, make, ms, N, Null, S } from "./platform-kit.ts";

const ORGANISER = "An organiser of the run.";
const W = { out: "signed-out", member: "org-with-member", closed: "run-closed", open: "run-open", accepted: "run-accepted" } as const;
const OUT = { error: error_NOT_AUTHENTICATED, given: W.out, when: "No one is signed in on this machine." } as const;
const NOT_ORG = { error: error_ROLE_PERMISSION_DENIED, given: W.member, when: "Not an organiser; nothing changes." } as const;
const NO_RUN = { error: error_INVALID_INPUT, given: W.closed, when: "No run has that id." } as const;
const NOT_CLOSED = { error: error_WRONG_STATE, given: W.open, when: "The run is not closed yet." } as const;

/** The manifest of one run's dataset (`manifest.json`): every fact needed to know what produced the entries. Schema `dataset/1`. */
export const RunManifest = Schema.Struct({
  schema: Schema.Literal("dataset/1"), run: S, scenario: Schema.Struct({ name: S, version: N, manifestHash: S }), template: Schema.Struct({ snapshot: S, snapshotId: S }), seed: N,
  clock: Schema.Struct({ mode: S, rate: N, start: S, end: S }),
  participants: Schema.Array(Schema.Struct({ seat: S, kind: Schema.Literals(["human", "agent"]), pseudonym: S, model: Null(S), policyVersion: Null(S), consent: Null(S), from: S, to: Null(S) })),
  software: Schema.Struct({ capxul: S, contracts: S, bench: S, book: S }),
  lineage: Schema.Array(Schema.Struct({ world: S, parent: Null(S), snapshot: Null(S), seq: Null(N) })),
  counts: Schema.Struct({ entries: N, refused: N, scoreLines: N }), trainingOk: B, startedAt: S, endedAt: S,
});

const manifest = (o: Record<string, unknown> = {}) => ({
  schema: "dataset/1", run: "r00042", scenario: { name: "town-of-four", version: 1, manifestHash: "sha256:9f2c1b7e" }, template: { snapshot: "town-of-four@m3", snapshotId: "snap_00a1" }, seed: 7,
  clock: { mode: "stepped", rate: 1, start: "2026-03-01T09:00:00Z", end: "2026-05-01T09:00:00Z" },
  participants: [{ seat: "bc-finance", kind: "agent", pseudonym: "p_9c41", model: "model-x", policyVersion: "ledger-agent@1", consent: null, from: "2026-03-01T09:00:00Z", to: null }],
  software: { capxul: "0.1.0+4b2ef00", contracts: "v4", bench: "sha256:1d9e", book: "4b2ef00" }, lineage: [{ world: "r00042", parent: null, snapshot: null, seq: null }],
  counts: { entries: 4210, refused: 61, scoreLines: 61 }, trainingOk: true, startedAt: "2026-11-20T10:00:00Z", endedAt: "2026-11-20T11:32:00Z", ...o });
const checks = (all = true) => [
  { id: "sequence-gap-free", passed: true, detail: "4210 entries, seq 1 to 4210, hash chain verified" },
  { id: "books-agree-with-chain", passed: all, detail: all ? "4 companies: every Safe balance equals its books' bank account" : "tamu-orchards: books 120.00 higher than the chain" },
  { id: "no-secret", passed: true, detail: "0 hits for 9 keys and 3 secrets, by value" }, { id: "manifest-complete", passed: true, detail: "every seat has kind, model or consent" }, { id: "consent", passed: true, detail: "all human seats consented to train, or none" },
];

const check = make({
  id: "run.check", command: "run check", title: "Check a closed run's data before it is accepted", rpc: "devnet.runs.check", kind: "query", priority: "critical", cls: "background", p95Ms: 120_000,
  about: "Runs the quality checks on a closed run and prints each: the record's sequence has no gap and its hash chain verifies; the books agree with the chain (every company's Safe balance equals its books' bank account, every payment's transaction hash exists, the outbox is drained); no secret is in the data (a search by value for every key and secret the world held); the manifest is complete; the clock plan was kept (world time never moved back except by a recorded restore); every human seat consented; the lineage resolves; no abandoned branch is mixed in unflagged; a redaction pass found no email or phone that is not a pseudonym.",
  who: ORGANISER, changes: "Nothing in the world; the result is kept with the run.", input: Schema.Struct({ run: S }), output: Schema.Struct({ run: S, passed: B, checks: Schema.Array(CheckLine) }),
  reads: [table_runs, table_command_records, table_world_members], claims: [{ claim: "A gap, a secret or a books-chain disagreement fails the check and names the cause.", observes: `cli: in a closed run with one entry removed from the record file, \`run check r00042 --json\` prints passed false and sequence-gap-free with the missing seq; with a test key appended to a result, no-secret fails.` }],
  refusals: [OUT, NO_RUN, NOT_ORG, NOT_CLOSED], examples: [ok("Every check passes", "capxul run check r00042 --json", { run: "r00042", passed: true, checks: checks() }), ok("A books-chain disagreement", "capxul run check r00043 --json", { run: "r00043", passed: false, checks: checks(false) }), refused("The run is still live", "capxul run check r00044 --json", error_WRONG_STATE, { state: "live" })],
});
export const rpc_devnet_runs_check = check.rpc;
export const operation_run_check = check.op;

const exp = make({
  id: "run.export", command: "run export", title: "Export a closed run as one dataset", rpc: "devnet.runs.export", kind: "action", priority: "critical", cls: "background", p95Ms: 120_000,
  about: "Writes the run's dataset to a folder: `manifest.json` (the run's manifest), `entries.jsonl` (the record, lineage first, one entry a line, with a pseudonym in place of every participant and personal data redacted), `scores.jsonl` (the scenario's measures after each step or day: the rewards), `checks.json` and `ledgers/` (each company's month-end books and chain balances). The schema version is `dataset/1`. A dataset is for training only if every human seat consented to `train` (agent-only runs always); otherwise it is marked evaluation-only.",
  who: ORGANISER, changes: "One dataset row and the files; nothing in the world.", input: Schema.Struct({ run: S, out: S }),
  output: Schema.Struct({ run: S, exportNo: N, path: S, schema: S, entries: N, scoreLines: N, manifestHash: S, trainingOk: B, manifest: RunManifest }),
  reads: [table_runs, table_command_records, table_run_seats, table_world_members], writes: [table_run_datasets],
  claims: [{ claim: "An export is one folder with the manifest, the entries, the scores and the checks, and no key, token, secret or participant's address.", observes: `cli: \`run export r00042 --out data/\` writes the five parts; a search of the folder by value for every test key, the shared secret and each participant's address finds nothing.` },
    { claim: "A dataset with a human seat that did not consent to training is marked evaluation-only.", observes: `cli: with one human seat on consent run, \`run export\` prints trainingOk false.` }],
  refusals: [OUT, NO_RUN, NOT_ORG, NOT_CLOSED],
  examples: [ok("Export the run", "capxul run export r00042 --out data/ --json", { run: "r00042", exportNo: 1, path: "data/r00042", schema: "dataset/1", entries: 4210, scoreLines: 61, manifestHash: "sha256:7be2a410", trainingOk: true, manifest: manifest() }), refused("The run is still live", "capxul run export r00044 --out data/ --json", error_WRONG_STATE, { state: "live" })],
});
export const rpc_devnet_runs_export = exp.rpc;
export const operation_run_export = exp.op;

const accept = make({
  id: "run.accept", command: "run accept", title: "Accept a run's dataset, or reject it", rpc: "devnet.runs.accept", kind: "mutation", priority: "critical", cls: "write",
  about: "Accepts a closed, exported run whose every quality check passes: the run becomes accepted and its dataset is the product. If a check fails the run becomes rejected, the dataset is kept and marked, and the failing checks are printed. Nothing is deleted either way.",
  who: ORGANISER, changes: "The run becomes accepted or rejected.", input: Schema.Struct({ run: S }), output: Schema.Struct({ run: S, state: Schema.Literals(["accepted", "rejected"]), checks: Schema.Array(CheckLine) }),
  reads: [table_run_datasets], writes: [table_runs, table_run_datasets], drives: [machine_run.t.accept, machine_run.t.reject],
  claims: [{ claim: "Only a dataset whose every check passes is accepted.", observes: `cli: \`run accept r00042\` prints accepted; \`run accept r00043\` (books disagree) prints rejected and the failing check.` }],
  refusals: [OUT, NO_RUN, NOT_ORG, { error: error_WRONG_STATE, given: W.closed, when: "The run is not closed and exported." }],
  examples: [ok("Accept", "capxul run accept r00042 --json", { run: "r00042", state: "accepted", checks: checks() }), ok("Reject", "capxul run accept r00043 --json", { run: "r00043", state: "rejected", checks: checks(false) }), refused("Not exported yet", "capxul run accept r00045 --json", error_WRONG_STATE, { state: "closed" })],
});
export const rpc_devnet_runs_accept = accept.rpc;
export const operation_run_accept = accept.op;

const archive = make({
  id: "run.archive", command: "run archive", title: "Archive a run: free its world, keep its data", rpc: "devnet.runs.archive", kind: "action", priority: "normal", cls: "background", p95Ms: 120_000,
  about: "Parks (`--park`, the default: the world can be restored to look at again) or destroys (`--destroy`) the run's world once its dataset is accepted or rejected. The record, the dataset and the run row stay.",
  who: ORGANISER, changes: "The run becomes archived; its world is parked or closed.", input: Schema.Struct({ run: S, destroy: B }), output: Schema.Struct({ run: S, state: Schema.Literal("archived"), world: Schema.Literals(["parked", "closed"]) }),
  reads: [table_runs], writes: [table_runs], drives: [machine_run.t.archive],
  claims: [{ claim: "An archived run costs storage only, and its dataset is still there.", observes: `cli: \`run archive r00042\` then \`world show r00042\` prints parked and the dataset folder is unchanged.` }],
  refusals: [OUT, NO_RUN, NOT_ORG, { error: error_WRONG_STATE, given: W.open, when: "The run has no accepted or rejected dataset yet." }],
  examples: [ok("Archive and park", "capxul run archive r00042 --json", { run: "r00042", state: "archived", world: "parked" }), refused("Not finished", "capxul run archive r00044 --json", error_WRONG_STATE, { state: "live" })],
});
export const rpc_devnet_runs_archive = archive.rpc;
export const operation_run_archive = archive.op;

const redact = make({
  id: "run.redact", command: "run redact", title: "Withdraw a participant's data from a run", rpc: "devnet.runs.redact", kind: "action", priority: "normal", cls: "write",
  about: "A participant withdraws consent: `run redact r00042 --participant p_9c41`. The member row is marked withdrawn, the participant's free text (what they typed in comments, names and notes) is removed from every export, the export is rewritten and marked, and the dataset's training flag becomes false if the withdrawn seat was human. The record itself is never edited: its entries keep the pseudonym and the commands, which hold no personal data once redacted.",
  who: "An organiser, or the participant for their own data.", changes: "The member is marked withdrawn; the dataset is rewritten.", input: Schema.Struct({ run: S, participant: S }), output: Schema.Struct({ run: S, participant: S, rewritten: B, trainingOk: B }),
  reads: [table_world_members], writes: [table_world_members, table_run_datasets],
  claims: [{ claim: "After a withdrawal the participant's free text is in no export.", observes: `cli: \`run redact r00042 --participant p_9c41\` then a search of every export of r00042 for a string that participant typed finds nothing.` }],
  refusals: [OUT, NO_RUN, NOT_ORG, { error: error_INVALID_INPUT, given: W.closed, when: "No such participant in the run." }],
  examples: [ok("Withdraw a participant", "capxul run redact r00042 --participant p_9c41 --json", { run: "r00042", participant: "p_9c41", rewritten: true, trainingOk: false }), refused("No such participant", "capxul run redact r00042 --participant p_0 --json", error_INVALID_INPUT, { field: "participant", name: "p_0" })],
});
export const rpc_devnet_runs_redact = redact.rpc;
export const operation_run_redact = redact.op;

void ms; void table_run_seats;
