// Journey 3: pay Brightside and branch the books. sam's payment is held; the operator saves the month as a template;
// the second operator branches it into a world of their own; sam pays in the first world, whose books then agree with
// its chain, and the branch never sees it; in the branch, a week passes and the held approval expires.
import { Site, startingWorlds } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { expect, given } from "../expectation.ts";
import { journey, outline } from "../journey.ts";
import { paymentsSent, usdc } from "../support/chain.ts";
import { addSeconds, hostNow, millis, same, sameAddress, sameAmount, sameInstant } from "../support/expect.ts";
import { mintedToPerson, wears } from "../support/hats.ts";
import { linesOf, report, safeAccount, safeCredits } from "../support/site.ts";
import { eventually } from "../support/wait.ts";
import { castMember, freshName, headOf, NORTHWIND, operators, recordOf, textOf, view } from "../support/world.ts";
import { closingSafeBalance, owedOn, safeBalanceOf, stateOf } from "./books.ts";
import { sign } from "./signatures.ts";

const steps = outline({
  draft: [
    "doc.create",
    "sam drafts a second invoice from Brightside, and a payment of 5,000 USDC from the company Safe",
  ],
  submit: [
    "doc.submit",
    "the second invoice posts and the drafted payment is held for sam; 5,000 USDC, and an invoice already posted, are refused",
  ],
  save: [
    "world.snapshot.save",
    "the operator saves m3, a template, and draft while the payment is held: the world is untouched",
  ],
  branch: [
    "world.snapshot.restore",
    "the second operator may not restore draft, but restores m3 into a world of their own, holding what m3 saved",
  ],
  pay: [
    "approval.sign",
    "sam pays Brightside once in the first world; wrong signatures are refused, a replay sends nothing more, and the branch does not see it",
  ],
  books: [
    "report.run",
    "the first world's books agree with its chain: the payment posted once, and the invoice is paid",
  ],
  apart: ["doc.create", "sam drafts a Supplier in the branch, which the first world never sees"],
  warp: [
    "world.clock.warp",
    "the branch's owner warps it a week and past the held approval's expiry: its chain and site follow, its daily job runs each day, and its clock never goes back",
  ],
  expired: ["approval.sign", "sam's held approval in the branch has expired: it is refused, and nothing is sent"],
  record: [
    "record.export",
    "each world's record holds every event once, in order, and a range answers only what it asks",
  ],
});

const sam = { as: "sam" } as const;
const SECOND_BILL = 40;
const TOO_MUCH = 5000;
const WEEK = 7 * 24 * 3600;
const MINUTE = 60_000;

export const payAndBranch = journey(
  {
    name: "pay Brightside and branch the books",
    story:
      "sam's payment to Brightside is held, the month is saved and branched into a second operator's world, sam pays in the first world and its books agree with its chain while the branch never sees it, and in the branch a week passes and the held approval expires.",
    given: startingWorlds.paymentDrafted,
    steps,
  },
  Effect.gen(function* () {
    const facts = yield* given(startingWorlds.paymentDrafted);
    const capxul = yield* Capxul;
    const { world, supplier, invoice, payment } = facts;
    const org = facts.founded.org;
    const companySafe = facts.founded.safe;
    const doc = (doctype: string, name: string) => ({ org, doctype, name });

    const [bill, big] = yield* steps.draft.run((op) =>
      Effect.gen(function* () {
        const fields = Site.invoiceFields(supplier.name, SECOND_BILL);
        const second = yield* op.succeeds({ org, doctype: Site.DOCTYPES.purchaseInvoice, fields }, sam);
        const account = yield* safeAccount(org, sam);
        const pay = Site.paymentFields(supplier.name, account, TOO_MUCH, null);
        return [second, yield* op.succeeds({ org, doctype: Site.DOCTYPES.paymentEntry, fields: pay }, sam)] as const;
      }),
    );

    const held = yield* steps.submit.run((op) =>
      Effect.gen(function* () {
        const poor = yield* op.refused("InsufficientBalance", doc(Site.DOCTYPES.paymentEntry, big.name), sam);
        yield* sameAddress("the Safe that holds too little", poor.safe, companySafe);
        yield* same("what was asked and held", [Number(poor.amount), Number(poor.balance)], [TOO_MUCH, 1000]);
        yield* op.answers("Posted", doc(Site.DOCTYPES.purchaseInvoice, bill.name), sam);
        const hold = yield* op.answers("Held", doc(Site.DOCTYPES.paymentEntry, payment.name), sam);
        yield* same("the held payment's document hash", hold.payment.documentHash, payment.hash);
        yield* sameAmount("the held amount", hold.payment.amount.amount, Site.INVOICE_AMOUNT);
        yield* same("the payee", hold.payment.payee, supplier.name);
        yield* sameAddress(
          "the payee's address",
          hold.payment.payeeAddress,
          textOf(supplier.fields, Site.SUPPLIER_FIELDS.paymentAddress),
        );
        const posted = yield* op.refused("NotADraft", doc(Site.DOCTYPES.purchaseInvoice, invoice.name), sam);
        yield* same("the posted invoice's docstatus", posted.docstatus, 1);
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
        const named = yield* operators;
        const [draftName, branchName] = yield* Effect.all([freshName("jd"), freshName("jb")]);
        const first = yield* view(world.world);
        const now = yield* hostNow;
        const lifetimeMinutes = Math.max(1, Math.floor((millis(first.expiresAt) - millis(now)) / MINUTE) - 5);
        const restore = (snapshot: string, as: string) => ({ world: world.world, snapshot, as, lifetimeMinutes });
        const refused = yield* op.refused("NotWorldOwner", restore("draft", draftName), { operator: "second" });
        yield* same("the owner of draft", refused.owner, named.first);
        const made = yield* op.succeeds(restore("m3", branchName), { operator: "second" });
        yield* same(
          "the branch's owner, parent position and clock",
          [made.owner, made.parent?.recordSeq, made.clock],
          [named.second, m3.recordSeq, m3.clock],
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
        yield* same("the branch's record, read by its owner", (yield* recordOf(there)).world, made.world);
        return made;
      }),
    );
    const there = { at: branch.door, operator: "second" } as const;
    const brightside = textOf(supplier.fields, Site.SUPPLIER_FIELDS.paymentAddress);

    yield* steps.pay.run((op) =>
      Effect.gen(function* () {
        const samIs = yield* castMember(world, "sam");
        const olga = yield* castMember(world, "olga");
        const bySam = yield* sign(held.approval);
        const invalid = yield* op.refused("SignatureInvalid", yield* sign(held.approval, olga.signer), sam);
        yield* sameAddress("the address the wrong signature recovers", invalid.recovered, olga.signer);
        yield* sameAddress("the address it must recover", invalid.expected, samIs.signer);
        yield* op.refused("ApprovalNotFound", { ...bySam, approval: "apr_nobodyissuedthis" }, sam);
        const notHers = yield* op.refused("NotYourApproval", bySam, { as: "olga" });
        yield* same("whose approval it is", notHers.signer, "sam");
        yield* same("the payments sent so far", (yield* paymentsSent(world, held.payment.paymentId)).length, 0);
        const branchBefore = yield* stateOf(branch, org, companySafe, there);
        const before = yield* Effect.all([usdc(world, brightside), usdc(world, companySafe)]);
        const sent = yield* op.answers("Sent", bySam, sam);
        yield* same("the subject sent", sent.subject, { kind: "payment", id: held.payment.request });
        const again = yield* op.answers("AlreadySent", bySam, sam);
        yield* same("the replay", [again.transaction, again.block], [sent.transaction, sent.block]);
        const receipt = yield* capxul.chain.transaction({ transaction: sent.transaction });
        const payments = Arr.filter(receipt.logs, (log) => log._tag === "PaymentSent");
        yield* same(
          "the payment sent",
          Arr.map(payments, (log) => (log._tag === "PaymentSent" ? [log.paymentId, log.documentHash] : [])),
          [[held.payment.paymentId, held.payment.documentHash]],
        );
        yield* same("the payments sent for it", (yield* paymentsSent(world, held.payment.paymentId)).length, 1);
        const after = yield* Effect.all([usdc(world, brightside), usdc(world, companySafe)]);
        yield* sameAmount("what Brightside gained", Number(after[0]) - Number(before[0]), Site.INVOICE_AMOUNT);
        yield* sameAmount("what the company Safe lost", Number(before[1]) - Number(after[1]), Site.INVOICE_AMOUNT);
        yield* same(
          "the branch after the first world's payment",
          yield* stateOf(branch, org, companySafe, there),
          branchBefore,
        );
      }),
    );

    yield* steps.books.run((op) =>
      Effect.gen(function* () {
        const ask = (name: string, filters: Readonly<Record<string, string>> = {}) => ({ org, report: name, filters });
        const all = yield* op.until(
          `the General Ledger to show ${held.name}`,
          ask(Site.REPORTS.generalLedger),
          sam,
          (rows) => linesOf(rows.rows, held.name).length > 0,
        );
        const credits = safeCredits(linesOf(all.rows, held.name));
        yield* same(
          `the company Safe's credits for ${held.name}`,
          Arr.map(credits, (row) => Number(row[Site.ROW_FIELDS.credit])),
          [Site.INVOICE_AMOUNT],
        );
        const account = yield* safeAccount(org, sam);
        const onChain = Number(yield* usdc(world, companySafe));
        const lines = yield* op.succeeds(
          ask(Site.REPORTS.generalLedger, { [Site.FILTERS.generalLedger.account]: account }),
          sam,
        );
        yield* sameAmount(`the General Ledger's balance of ${account}`, safeBalanceOf(lines.rows), onChain);
        const trial = yield* op.succeeds(ask(Site.REPORTS.trialBalance), sam);
        yield* sameAmount(
          `the Trial Balance's closing balance of ${account}`,
          yield* closingSafeBalance(trial.rows),
          onChain,
        );
        const payable = yield* op.succeeds(ask(Site.REPORTS.accountsPayable), sam);
        yield* sameAmount(`what is owed on ${invoice.name}`, owedOn(payable.rows, invoice.name), 0);
      }),
    );

    yield* steps.apart.run((op) =>
      Effect.gen(function* () {
        const firstHead = yield* headOf();
        yield* op.succeeds(
          { org, doctype: Site.DOCTYPES.supplier, fields: Site.supplierFields("Isolation Ltd") },
          { ...there, as: "sam" },
        );
        yield* same("the first world's record head after the branch's document", yield* headOf(), firstHead);
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
        yield* op.refused("ClockBackwards", { target: { _tag: "to", at: was } }, there);
        if (millis(held.approval.expiresAt) >= millis(warped.clock.now))
          yield* op.succeeds({ target: { _tag: "to", at: addSeconds(held.approval.expiresAt, 60) } }, there);
      }),
    );

    yield* steps.expired.run((op) =>
      Effect.gen(function* () {
        const expired = yield* op.refused("ApprovalExpired", yield* sign(held.approval), { ...there, as: "sam" });
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
