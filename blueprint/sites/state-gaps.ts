import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import * as d from "./data.ts";
export const decision_sites_state_gaps = defineDecision({
  id: "sites.lifecycle-state-gaps", title: "Administrative site states stay reserved without public operations",
  question: "Why are suspend, resume and archive undriven?",
  options: [{ label: "reserved", text: "undriven-transition: site.suspend stands as a reserved administrative state for abuse or maintenance; no current RPC or workflow is authorized to suspend a company site. site.resume stands as its inverse; world resume restores resources, not authority to clear an administrative suspension. site.archive stands for future Organization closure; no Organization-close producer is specified. World parking and destruction concern simulated resources, not company closure or site suspension, so must not be falsely linked to these transitions." }],
  chosen: "reserved", why: "sites.lifecycle specifies creation and retry, but no Organization-close event or suspension authority surface. Keep defensive states without inventing public commands or an unpaid-site billing policy. These gaps stay visible until those policies and producers are designed.",
  source: "Builder, m1-gaps-states; lane findings.json; sites.lifecycle; sites/data.ts and processes.ts",
  stands: [
  {
    "record": "transition:site.suspend",
    "rule": "undriven-transition",
    "why": "sites.lifecycle specifies creation and retry, but no Organization-close event or suspension authority surface. Keep defensive states without inventing public commands or an unpaid-site billing policy. These gaps stay visible until those policies and producers are designed."
  },
  {
    "record": "transition:site.resume",
    "rule": "undriven-transition",
    "why": "sites.lifecycle specifies creation and retry, but no Organization-close event or suspension authority surface. Keep defensive states without inventing public commands or an unpaid-site billing policy. These gaps stay visible until those policies and producers are designed."
  },
  {
    "record": "transition:site.archive",
    "rule": "undriven-transition",
    "why": "sites.lifecycle specifies creation and retry, but no Organization-close event or suspension authority surface. Keep defensive states without inventing public commands or an unpaid-site billing policy. These gaps stay visible until those policies and producers are designed."
  }
],
  affects: [d.machine_site.t.suspend, d.machine_site.t.resume, d.machine_site.t.archive],
});
