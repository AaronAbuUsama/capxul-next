// record.export, claim 2: the record is the world's events: every event a successful call emitted is one entry, in
// order, carrying exactly what the event carried, and a refused call or a read adds none. The calls that made
// `paid` were not the scenario's, and Capxul shows a scenario no trace ids, so two things are read: every entry so
// far is a declared event carrying exactly its fields, and the events of the starting worlds' steps occur in order;
// then the scenario's own calls (two documents, a refused call and a report) add exactly their two doc_created,
// carrying what the answers say, at the world's frozen now, under two traces. Not checked: each entry's trace id
// against the trace its call was sent under.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { expect, scenario } from "../scenario.ts";
import { refusal, same, sameInstant, show } from "../support/expect.ts";
import { create, ledger, supplierFields } from "../support/books.ts";
import { carriesExactly, holdsInOrder, inOrder } from "../support/record.ts";
import { entriesAfter, northwind, record } from "../support/world.ts";

const STEPS = [
  "world_created",
  "org_founded",
  "approval_signed",
  "approval_signed",
  "approval_landed",
  "officer_change_proposed",
  "proposal_opened",
  "approval_signed",
  "approval_signed",
  "approval_landed",
  "doc_created",
  "doc_created",
  "doc_submitted",
  "doc_created",
  "payment_held",
  "approval_signed",
  "approval_landed",
];

export const recordExport2 = scenario(
  { operation: "record.export", claim: 2 },
  Effect.gen(function* () {
    const { world, org } = yield* northwind;
    const exported = yield* record;
    yield* inOrder(exported.entries, 1);
    yield* Effect.forEach(exported.entries, carriesExactly, { discard: true });
    yield* holdsInOrder(exported.entries, STEPS);

    const first = yield* create(org, "Supplier", supplierFields("Record Check Ltd"), "sam");
    yield* ledger(org, {}, "sam");
    yield* refusal(
      "doc.create as pat",
      "NoSiteUser",
      create(org, "Supplier", supplierFields("Record Check Ltd"), "pat"),
    );
    const second = yield* create(org, "Supplier", supplierFields("Record Check Two Ltd"), "sam");

    const added = yield* entriesAfter(exported.head);
    yield* inOrder(added, exported.head + 1);
    yield* same(
      "the entries the scenario's calls added",
      Arr.map(added, (entry) => ({ event: entry.event, carried: entry.carried })),
      [
        { event: "doc_created", carried: { org, doctype: "Supplier", name: first.name } },
        { event: "doc_created", carried: { org, doctype: "Supplier", name: second.name } },
      ],
    );
    for (const entry of added) yield* sameInstant(`entry ${entry.seq}'s time`, entry.at, world.clock.now);
    const traces = Arr.map(added, (entry) => entry.trace);
    yield* expect(
      Arr.every(traces, (trace) => trace !== "") && Arr.dedupe(traces).length === 2,
      `the two calls' entries share or lack a trace: ${show(traces)}`,
    );
  }),
);
