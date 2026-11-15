// Journey: branch the books of a held payment. sam's payment is held; the operator saves the month as a template; the
// second operator branches it into a world of their own; sam pays in the first world and the branch never sees it; in
// the branch a week passes and the held approval expires. It acts on whole worlds (it saves, restores and warps them),
// so it keeps a world of its own and never runs in a world shared with other journeys (roadmap step 4.11).
import { Site, startingWorlds as begins } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { expect, given } from "../expectation.ts";
import { journey, outline } from "../journey.ts";
import { paymentsSent, usdc } from "../support/chain.ts";
import { addSeconds, hostNow, millis, same, sameAmount, sameInstant } from "../support/expect.ts";
import { mintedToPerson, wears } from "../support/hats.ts";
import { report } from "../support/site.ts";
import { eventually } from "../support/wait.ts";
import { freshName, headOf, NORTHWIND, operators, recordOf, view } from "../support/world.ts";
import { stateOf } from "./books.ts";
import { named } from "../support/names.ts";
import { sign } from "./signatures.ts";

const steps = outline({
  hold: [named["doc.submit"], "sam submits the drafted payment to Brightside, which is held for his signature"],
  save: [
    named["world.snapshot.save"],
    "the operator saves m3, a template, and draft while the payment is held: the world is untouched",
  ],
  branch: [
    named["world.snapshot.restore"],
    "the second operator may not restore draft, but restores m3 into a world of their own, holding what m3 saved",
  ],
  pay: [named["approval.sign"], "sam pays Brightside in the first world, and the branch does not see it"],
  apart: [named["doc.create"], "sam drafts a Supplier in the branch, which the first world never sees"],
  warp: [
    named["world.clock.warp"],
    "the branch's operator warps it a week and past the held approval's expiry: its chain and site follow, its daily job runs each day, and its clock never goes back",
  ],
  expired: [
    named["approval.sign"],
    "sam's held approval in the branch has expired: it is refused, and nothing is sent",
  ],
  record: [
    named["record.export"],
    "each world's history holds every event once, in order, and a range answers only what it asks",
  ],
});

const sam = { as: "sam" } as const;
const WEEK = 7 * 24 * 3600;
const MINUTE = 60_000;

export const branchTheBooks = journey(
  {
    name: "branch the books of a held payment",
    story:
      "sam's payment to Brightside is held, the month is saved and branched into a second operator's world, sam pays in the first world while the branch never sees it, and in the branch a week passes and the held approval expires.",
    given: begins.paymentDrafted,
    steps,
  },
  Effect.gen(function* () {
    const facts = yield* given(begins.paymentDrafted);
    const { world, payment } = facts;
    const org = facts.founded.org;
    const companySafe = facts.founded.safe;
    const doc = (doctype: string, name: string) => ({ org, doctype, name });

    const held = yield* steps.hold.run((op) =>
      Effect.gen(function* () {
        const hold = yield* op.answers(named["Held"], doc(Site.DOCTYPES.paymentEntry, payment.name), sam);
        yield* same("the held payment's document hash", hold.payment.documentHash, payment.hash);
        return hold;
      }),
    );

    const m3 = yield* steps.save.run((op) =>
      Effect.gen(function* () {
        const before = yield* stateOf(world, org, companySafe, {});
        const saved = yield* op.succeeds({ world: world.world, snapshot: "m3", replace: false, template: true });
        yield* op.succeeds({ world: world.world, snapshot: "draft", replace: false, template: false });
        const after = yield* stateOf(world, org, companySafe, {});
        yield* same("the books and Safes after the saves", [after.books, after.safes], [before.books, before.safes]);
        return saved;
      }),
    );

    const branch = yield* steps.branch.run((op) =>
      Effect.gen(function* () {
        const operator = yield* operators;
        const [draftName, branchName] = yield* Effect.all([freshName("jd"), freshName("jb")]);
        const first = yield* view(world.world);
        const now = yield* hostNow;
        const lifetimeMinutes = Math.max(1, Math.floor((millis(first.expiresAt) - millis(now)) / MINUTE) - 5);
        const restore = (snapshot: string, as: string) => ({ world: world.world, snapshot, as, lifetimeMinutes });
        const refused = yield* op.refused(named["NotWorldOwner"], restore("draft", draftName), { operator: "second" });
        yield* same("who holds draft", refused.owner, operator.first);
        const made = yield* op.succeeds(restore("m3", branchName), { operator: "second" });
        yield* same(
          "the branch's operator, parent position and clock",
          [made.owner, made.parent?.recordSeq, made.clock],
          [operator.second, m3.recordSeq, m3.clock],
        );
        const there = { at: made.door, operator: "second" } as const;
        yield* eventually(`northwind's site in ${made.world} to be ready`, view(made.world), (shown) =>
          Arr.some(shown.companies, (each) => each.handle === NORTHWIND && each.site.state === "ready"),
        );
        yield* same("the branch's books and Safes", yield* stateOf(made, org, companySafe, there), {
          ...(yield* stateOf(world, org, companySafe, {})),
          head: m3.recordSeq + 1,
        });
        const trial = (who: typeof there | object) => report(org, Site.REPORTS.trialBalance, {}, { ...who, as: "sam" });
        yield* same("the branch's Trial Balance", yield* trial(there), yield* trial({}));
        const minted = yield* mintedToPerson(world, facts.grantSent.transaction, "sam");
        yield* expect(
          yield* wears(made, minted.hat, minted.safe, null, there),
          "sam's Safe does not wear the Books hat in the branch",
        );
        yield* same("the branch's history, read by its operator", (yield* recordOf(there)).world, made.world);
        return made;
      }),
    );
    const there = { at: branch.door, operator: "second" } as const;

    yield* steps.pay.run((op) =>
      Effect.gen(function* () {
        const branchBefore = yield* stateOf(branch, org, companySafe, there);
        const sent = yield* op.answers(named["Sent"], yield* sign(held.approval), sam);
        yield* same("the subject sent", sent.subject, { kind: "payment", id: held.payment.request });
        yield* same("the payments sent for it", (yield* paymentsSent(world, held.payment.paymentId)).length, 1);
        yield* same(
          "the branch after the first world's payment",
          yield* stateOf(branch, org, companySafe, there),
          branchBefore,
        );
      }),
    );

    yield* steps.apart.run((op) =>
      Effect.gen(function* () {
        const firstHead = yield* headOf();
        yield* op.succeeds(
          { org, doctype: Site.DOCTYPES.supplier, fields: Site.supplierFields("Isolation Ltd") },
          { ...there, as: "sam" },
        );
        yield* same("the first world's history head after the branch's document", yield* headOf(), firstHead);
      }),
    );

    yield* steps.warp.run((op) =>
      Effect.gen(function* () {
        const runs = report(
          org,
          Site.REPORTS.scheduledJobLog,
          { [Site.FILTERS.scheduledJobLog.job]: Site.DAILY_JOB.jobType },
          { ...there, as: "dana" },
        );
        const ran = (yield* runs).length;
        const was = (yield* view(branch.world)).clock.now;
        const warped = yield* op.succeeds({ target: { _tag: "by", seconds: WEEK } }, there);
        yield* same("the sites that followed", warped.sites, 1);
        yield* same(`the runs of ${Site.DAILY_JOB.jobType} the week added`, (yield* runs).length - ran, 7);
        yield* op.refused(named["ClockBackwards"], { target: { _tag: "to", at: was } }, there);
        if (millis(held.approval.expiresAt) >= millis(warped.clock.now))
          yield* op.succeeds({ target: { _tag: "to", at: addSeconds(held.approval.expiresAt, 60) } }, there);
      }),
    );

    yield* steps.expired.run((op) =>
      Effect.gen(function* () {
        const expired = yield* op.refused(named["ApprovalExpired"], yield* sign(held.approval), {
          ...there,
          as: "sam",
        });
        yield* sameInstant("when it expired", expired.expiredAt, held.approval.expiresAt);
        yield* same(
          "the payments sent in the branch",
          (yield* paymentsSent(branch, held.payment.paymentId, there)).length,
          0,
        );
        yield* sameAmount("the branch's company Safe", yield* usdc(branch, companySafe, there), 1000);
      }),
    );

    yield* steps.record.run((op) =>
      Effect.gen(function* () {
        const whole = yield* op.succeeds({ from: null, to: null });
        const range = yield* op.succeeds({ from: 2, to: 3 });
        yield* same(
          "the entries from 2 to 3",
          range.entries,
          Arr.filter(whole.entries, (each) => each.seq >= 2 && each.seq <= 3),
        );
        const past = yield* op.succeeds({ from: whole.head + 1, to: null });
        yield* same("past the head", [past.entries, past.head], [[], whole.head]);
        const theirs = yield* op.succeeds({ from: null, to: null }, there);
        yield* same("the branch's lineage", theirs.lineage, branch.parent);
      }),
    );
  }),
);
