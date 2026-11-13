// record.export, claim 2: the record is the world's events: every event a successful call emitted is one entry, in
// order, carrying exactly what the event carried, and a refused call or a read adds none. Every call made in making
// `paid` (the `calls` fact) must have left under its trace exactly what its declaration computes from its payload
// and answer, in the order the calls were made; then the scenario's own calls (two documents, a refused call and a
// report) add exactly their two doc_created, at the world's frozen now, under two traces of their own.
import { Site, startingWorlds } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { expect, given, scenario } from "../scenario.ts";
import { refusal, same, sameInstant, show } from "../support/expect.ts";
import { carriesExactly, entriesOfCall, inOrder } from "../support/record.ts";
import { create, ledger } from "../support/site.ts";
import { entriesAfter, record, view } from "../support/world.ts";

export const recordExport2 = scenario(
  { operation: "record.export", claim: 2 },
  Effect.gen(function* () {
    const facts = yield* given(startingWorlds.paid);
    const org = facts.founded.org;
    const exported = yield* record;
    const world = yield* view(exported.world);
    yield* inOrder(exported.entries, 1);
    yield* Effect.forEach(exported.entries, carriesExactly, { discard: true });

    let last = 0;
    for (const call of facts.calls) {
      const under = Arr.filter(exported.entries, (entry) => entry.trace === call.trace);
      const expected = yield* entriesOfCall(call);
      yield* same(
        `the entries under the ${call.operation} call ${call.trace} (${call.outcome})`,
        Arr.map(under, (entry) => ({ event: entry.event, carried: entry.carried })),
        expected,
      );
      for (const entry of under) {
        yield* expect(
          entry.seq > last,
          `entry ${entry.seq} of ${call.operation} ${call.trace} comes before an earlier call's`,
        );
        last = entry.seq;
      }
    }

    const sam = { as: "sam" };
    const first = yield* create(org, Site.DOCTYPES.supplier, Site.supplierFields("Record Check Ltd"), sam);
    yield* ledger(org, {}, sam);
    yield* refusal(
      "doc.create as pat",
      "NoSiteUser",
      create(org, Site.DOCTYPES.supplier, Site.supplierFields("Record Check Ltd"), { as: "pat" }),
    );
    const second = yield* create(org, Site.DOCTYPES.supplier, Site.supplierFields("Record Check Two Ltd"), sam);

    const added = yield* entriesAfter(exported.head);
    yield* inOrder(added, exported.head + 1);
    yield* same(
      "the entries the scenario's calls added",
      Arr.map(added, (entry) => ({ event: entry.event, carried: entry.carried })),
      [
        { event: "doc_created", carried: { org, doctype: Site.DOCTYPES.supplier, name: first.name } },
        { event: "doc_created", carried: { org, doctype: Site.DOCTYPES.supplier, name: second.name } },
      ],
    );
    for (const entry of added) yield* sameInstant(`entry ${entry.seq}'s time`, entry.at, world.clock.now);
    const traces = Arr.map(added, (entry) => entry.trace);
    const known = Arr.map(facts.calls, (call) => call.trace);
    yield* expect(
      Arr.dedupe(traces).length === 2 && !Arr.some(traces, (trace) => trace === "" || Arr.contains(known, trace)),
      `the two calls' entries share, lack or reuse a trace: ${show(traces)}`,
    );
  }),
);
