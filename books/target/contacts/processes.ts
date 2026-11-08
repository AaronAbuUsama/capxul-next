// Contacts' durable processes: one, the CRM's sync with a connected Frappe head.
//
// An address book entry, a lead and a deal change only inside an rpc: nothing about them waits on a
// signature, the chain, a date, a person or Bridge, so none has a process of its own (decision
// rules.durable-processes). A lead's conversion is one transaction; a deal's expected closure date
// is a forecast, not a timer. The member relationship is read from organizations' Seats when the
// book is read, so no workflow copies it. The old `parties.contacts.emitRelationshipChanged` action
// only posted telemetry after a write (P7: the machines' events now leave through the outbox) and
// is not ported.
//
// The head sync is the CRM's share of a connected head: each app concept syncs its own records
// (organizations.head-ownership), and this is contacts' (decision contacts.head-sync).

import { budget, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_contacts } from "../shared/foundation.ts";
import { integration_frappe_head } from "../shared/external.ts";
import { event_org_head_transitioned, machine_org_head, table_org_deployments, table_org_heads, table_org_members } from "../organizations/data.ts";
import { table_principals } from "../access/data.ts";
import { table_parties } from "../parties/data.ts";
import { procedure_parties_resolve_recipient } from "../parties/procedures.ts";
import { table_hat_wearers } from "../indexing/data.ts";
import {
  machine_contact,
  machine_deal,
  machine_lead,
  table_contact_changes,
  table_contact_head_syncs,
  table_contacts,
  table_crm_settings,
  table_deal_contacts,
  table_deals,
  table_leads,
} from "./data.ts";

const DAY = 86_400_000;
const RECORDS = [table_contacts, table_leads, table_deals, table_deal_contacts];

export const workflow_contacts_head_sync = defineWorkflow({
  id: "contacts.head.sync",
  title: "Sync the Organization's CRM with its connected head",
  about:
    "Started when a head connection is confirmed, one instance per connection; it waits on two systems for as long as " +
    "the head is connected and must survive a crash. Push: it pages `contact-changes` after `pushed_seq` and writes " +
    "each changed record as it stands to the head (`upsertDocs`, in seq order, each with its version and the version " +
    "the head was last given), the first time from seq 1, so the head gets the whole CRM in order; how each record " +
    "meets its document there (names, members' Users, a lead's conversion, a head that already holds a CRM) is " +
    "contacts.head-mapping. Pull: it reads the head's own changes after `pulled_change` (`listChanges`) and applies " +
    "each by the rules of organizations.head-ownership, through the same checks and transitions the CRM's rpcs use, " +
    "with its change logged `origin` head. The editor must be a member whose Safe wears the People hat, matched by the " +
    "head user's mailbox, as for every CRM write (aaron.contacts-permissions). An edit by anyone else, one based on an " +
    "older version (a conflict), one the checks refuse, and a deletion are not applied: Capxul's version is pushed back " +
    "over it, and a refused document born in the head is left there with no `capxul_id`, counted `refused`. An entry's " +
    "Party is Capxul's alone: a head never sets or changes `capxul_party`. A Contact born in the head with a primary " +
    "mailbox is named in the directory through `parties.resolve-recipient`, as a recorded person is, unless that Party " +
    "already has an entry in the book (then it is refused, never merged); one with none, and every CRM Organization " +
    "born there, is a private entry. It wakes on a CRM change here, on the head's ring, and once a day to catch a " +
    "missed ring; while the head is failing it waits. It ends when the head is disconnected; the records stay.",
  concept: concept_contacts,
  priority: "normal",
  trigger: { transition: machine_org_head.t.confirm },
  instance: { per: table_contact_head_syncs },
  waits: [
    {
      name: "capxul-change",
      for: "signal",
      key: [{ on: [table_contact_changes], props: ["org_id"] }],
      about: "A CRM record changed here: push it.",
    },
    {
      name: "ring",
      for: "signal",
      key: [{ on: [table_org_heads], props: ["org_id", "head_id"] }],
      about: "The head rang its doorbell (organizations.heads.ring stamped the connection): pull its changes.",
    },
    { name: "catch-up", for: "timer", timeoutMs: DAY, about: "A day after the last pull: pull, in case a ring was lost." },
    {
      name: "disconnected",
      for: "signal",
      key: [{ on: [event_org_head_transitioned], props: ["org_id", "head_id"] }],
      about: "The head stopped failing, started failing, or was disconnected: carry on, wait, or end.",
    },
  ],
  steps: [
    {
      name: "push",
      about:
        "Page contact-changes after pushed_seq; upsertDocs in seq order (a member's own row is skipped while the member " +
        "holds a Seat); record the head's names; advance pushed_seq.",
    },
    {
      name: "pull",
      about:
        "listChanges after pulled_change; apply what a People hat wearer changed; push back a conflict, a refusal or a " +
        "deletion; leave a refused head-born document unadopted; advance pulled_change.",
    },
    { name: "await", about: "Wait for a change here, a ring, the daily catch-up or the connection's next transition." },
  ],
  // The People hat's id is the deployment's; its wearers are indexing's (contacts.members-write).
  reads: [
    table_org_heads, table_org_members, table_org_deployments, table_hat_wearers, table_principals, table_parties, table_contact_head_syncs,
    table_contact_changes, table_crm_settings, ...RECORDS,
  ],
  writes: [table_contact_head_syncs, table_contact_changes, table_crm_settings, ...RECORDS],
  drives: [
    machine_contact.t.hide,
    machine_contact.t.unhide,
    machine_lead.t.capture,
    machine_lead.t.reopen,
    machine_lead.t.engage,
    machine_lead.t.qualify,
    machine_lead.t.lose,
    machine_lead.t.convert,
    machine_deal.t.start,
    machine_deal.t.reopen,
    machine_deal.t.engage,
    machine_deal.t.win,
    machine_deal.t.lose,
  ],
  invokes: [procedure_parties_resolve_recipient],
  emits: [],
  calls: [integration_frappe_head.c.upsertDocs, integration_frappe_head.c.listChanges],
  chain: [],
  idempotency:
    "One process per head connection (`contacts-head:<orgId>:<headId>`). A push is idempotent by version (the head " +
    "answers unchanged), and a pulled change already applied is skipped by its head name and time.",
  timeoutMs: 3650 * DAY,
  retries: { max: 8, backoff: "exponential" },
  budget: budget("background"),
});
