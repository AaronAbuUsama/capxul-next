// Moved out of the built book by the cut, 10 November 2026, from books/target/requests/decisions.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { defineDecision } from "../../../packages/book/src/index.ts";
import { concept_books, concept_requests } from "../shared/foundation.ts";
import { contract_escrow, contract_escrow_factory, integration_indexer, integration_service_signer } from "../shared/external.ts";
import * as d from "./data.ts";
import * as iss from "./issuing.ts";
import * as inb from "./inbox.ts";
import * as svc from "./services.ts";
import * as co from "./checkout.ts";
import * as dep from "./deposits.ts";
import * as p from "./processes.ts";
import * as fl from "./flows.ts";
import * as op from "./operations.ts";

const PREVIEW_FLOWS = [
  fl.flow_client_account_requests_cancel,
  fl.flow_client_account_inbox_decline,
  fl.flow_client_account_services_revise,
  fl.flow_client_account_services_deactivate,
  fl.flow_client_banking_deposits_match,
  fl.flow_client_checkouts_pay,
];

export const decision_requests_service_machine = defineDecision({
  id: "requests.service-machine",
  title: "A service's status is a machine; each revision is a transition",
  question: "The old `active` boolean had one transition and revisions sent their own event. How does the target book it?",
  options: [
    { label: "machine", text: "`status` active or inactive; `create` from no state, `revise` active to active, `deactivate`; one event." },
    { label: "boolean", text: "Keep the boolean and send a separate event for revisions." },
  ],
  chosen: "machine",
  why:
    "P7: one event per machine, from every transition. A revision changes the row (its revision) though not its status, " +
    "so `revise` is a self-transition and 'each revision is reported once, in order' is the event's `revision` prop.",
  source: by("docs/as-is/archive/requests/data.ts (fixed-offer machine); service.revise.yaml (acceptance 2)"),
  affects: [d.machine_service, d.event_service_transitioned, d.table_services],
});
