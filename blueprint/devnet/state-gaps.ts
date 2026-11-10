import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import * as d from "./data.ts";
import { table_record_entries } from "./record-entry.ts";
import { machine_world } from "./world-data.ts";
import { machine_run } from "./platform-data.ts";
export const decision_devnet_state_gaps = defineDecision({
  id: "devnet.external-writer-gaps", title: "Recorder and fake-layer writers are outside the command link graph",
  question: "Why do the recorder and mail sink writer gaps stand?",
  options: [{ label: "external-writers", text: "unwritten-table: record-entries is written by the recorder append boundary after each command, including refusal, failure and restore lineage (spikes/skeleton/core/src/record.ts). It is JSON Lines, not an RPC transaction table. command-records remains the designed searchable projection. unwritten-table: mail-messages is written by the mail integration devnet fake on send and supervisor mail receive on inbound delivery. devnet.mail-sink records idempotency, fault spending and threading; these are not product operation or workflow writes." }],
  chosen: "external-writers", why: "The schema has no writer edge for recorder middleware or integration fake layers. Preserve the wire and sink records; adding a fake RPC solely for a graph edge would violate P2.",
  source: "Builder, m1-gaps-states; lane findings.json; devnet.mail-sink; devnet/record-entry.ts",
  affects: [table_record_entries, d.table_mail_messages],
});
export const decision_devnet_completion_drivers = defineDecision({
  id: "devnet.completion-drivers", title: "Snapshot restore completes its world transition; world resume resumes its run",
  question: "Who drives restored and run resume?",
  options: [{ label: "existing-rpcs", text: "devnet.worlds.snapshot-restore drives world.restored only after the in-place restore succeeds, following world.restore. The --as branch makes a different world, not an in-place completion. devnet.worlds.resume drives run.resume when its world belongs to a paused run; ordinary worlds have no run transition. It writes that run alongside the world, as the existing run machine promises." }],
  chosen: "existing-rpcs", why: "These are missing graph edges for outcomes already promised by the current RPC and run machine, not new operations. Failed restores must not emit restored and unrelated worlds must not emit run events.",
  source: "Builder, m1-gaps-states; devnet/world-rpcs.ts; platform-lifecycle.ts; platform-data.ts",
  affects: [machine_world.t.restored, machine_run.t.resume],
});
