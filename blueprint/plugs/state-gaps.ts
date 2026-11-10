import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import * as d from "./data.ts";
export const decision_plugs_state_gaps = defineDecision({
  id: "plugs.runtime-state-gaps", title: "Release data and refund matching are not ordinary command writes",
  question: "Why do the map writer and refund transition gaps stand?",
  options: [{ label: "explicit-boundaries", text: [
    "unwritten-table: hat-role-map is immutable versioned release data shipped with the Capxul app, seeded by app deployment, not by a customer operation or workflow. Its global scope and version key deliberately allow no tenant writer.",
    "undriven-transition: payment-request.reverse stands for the refund outcome in plugs.reversal-not-deletion. A new refund payment is required, never deletion or unsending. The active settle process matches the original payment hash; a reliable original-to-refund correlation carrier is not yet specified. Keep this boundary until that carrier and its consumer are designed; do not drive reverse for ordinary settlement or reorg."
  ].join("\n") }],
  chosen: "explicit-boundaries", why: "Retain these graph gaps rather than inventing an RPC or a refund correlation rule merely to satisfy reachability. Refund correlation remains a design boundary, not an implementation claim.",
  source: "Builder, m1-gaps-states; lane findings.json; plugs/data.ts; plugs.reversal-not-deletion; plugs/signer.ts",
  affects: [d.table_hat_role_map, d.machine_payment_request.t.reverse],
});
