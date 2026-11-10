// The g8 company journey. Step tests and the spike's partial evidence are mapped in
// evals/thin-line.md and evals/bindings/thin-line.json; existing claims are not narrowed.
import { defineDecision, defineJourney } from "../../packages/blueprint-engine/src/index.ts";
import { operation_org_create } from "../organizations/operations.ts";
import { operation_org_member_grant } from "../board/operations.ts";
import { operation_payment_send } from "../payments/operations.ts";
import * as s from "./operations.ts";
import * as w from "../devnet/world-ops.ts";

export const journey_thin_line = defineJourney({
  id: "thin_line",
  title: "A company through the whole stack in a shared world",
  about: "Exit g8: create a full simulated world on the sites machine, create its company and site, grant a hat, create a supplier invoice and Safe Payment Entry through the door, submit and hold it, sign with the holder's test key, read the books, move time, read the record, save and restore a separate world, and read its lineage. Run the same step tests locally and hosted; spikes/skeleton/run.sh supplies partial evidence, not proof of hosted creation or real v4 contracts. evals/thin-line.md defines each step's test and its remaining assertions.",
  steps: [
    { operation: w.operation_world_create, as: "operator", proves: "success" },
    { operation: operation_org_create, as: "founder", proves: "success" },
    { operation: operation_org_member_grant, as: "director", proves: "success" },
    { operation: s.operation_doc_create, as: "office-holder", proves: "success" },
    { operation: s.operation_doc_submit, as: "office-holder", proves: "success" },
    { operation: operation_payment_send, as: "office-holder", proves: "success" },
    { operation: s.operation_report_run, as: "office-holder", proves: "success" },
    { operation: w.operation_world_clock_warp, as: "operator", proves: "success" },
    { operation: w.operation_record_export, as: "operator", proves: "success" },
    { operation: w.operation_world_snapshot_save, as: "operator", proves: "success" },
    { operation: w.operation_world_snapshot_restore, as: "operator", proves: "success" },
    { operation: w.operation_world_show, as: "operator", proves: "success" },
  ],
  was: ["plan/plan.json (m1 exit g8)", "spikes/skeleton/run.sh (B1-B9)", "docs/mission/critical-path.md"],
});

export const decision_sites_thin_line = defineDecision({
  id: "sites.thin-line-tests",
  title: "The thin line uses existing step claims and keeps spike shortfalls visible",
  question: "How is g8 recorded and tested without treating the spike as the target?",
  options: [{ label: "reuse-claims", text: "One ordered cross-stack journey; one primary acceptance eval per step, with the mapping in evals/thin-line.md. Reuse the existing eval identities and strict bindings. Partial spike evidence is a near-miss and never passes a target claim. The aggregate journey also remains a near-miss until the real v4, hosted, one-command creation and all ordered step assertions run together." }],
  chosen: "reuse-claims",
  why: "g8 requires the same tests on a laptop and on the sites machine, not two definitions of success. Operation acceptance evals already appear under --journey and on the portal. The spike uses a Core stub and pre-existing main world; its approval sign is evidence for the target payment send step, not a new target command. Success proves the journey steps; event order is a separate fun:thin_line eval and is not inferred from the checks.",
  source: "m1-thin-line-journey; plan/plan.json g8; aaron.one-door; spikes/skeleton/run.sh; docs/blueprint.md (Evals run)",
  affects: [journey_thin_line],
});
