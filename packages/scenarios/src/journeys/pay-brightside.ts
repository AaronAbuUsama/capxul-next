// Journey: pay Brightside. sam drafts a second bill and a payment the company cannot afford; the bill posts, the drafted
// payment is held for sam's signature and the one too large is refused; wrong signatures are refused; sam pays once, a
// replay sends nothing more, and the books agree with the chain. It acts on its own company only, so it can run beside
// other journeys in one world. The snapshot round trip of a held payment is a journey of its own (branch-the-books.ts).
import { Site, startingWorlds as begins } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { given } from "../expectation.ts";
import { journey, outline } from "../journey.ts";
import { paymentsSent, usdc } from "../support/chain.ts";
import { same, sameAddress, sameAmount } from "../support/expect.ts";
import { linesOf, safeAccount, safeCredits } from "../support/site.ts";
import { castMember, textOf } from "../support/world.ts";
import { closingSafeBalance, owedOn, safeBalanceOf } from "./books.ts";
import { named } from "../support/names.ts";
import { sign } from "./signatures.ts";

const steps = outline({
  draft: [
    named["doc.create"],
    "sam drafts a second invoice from Brightside, and a payment of 5,000 USDC from the company Safe",
  ],
  submit: [
    named["doc.submit"],
    "the second invoice posts and the drafted payment is held for sam; 5,000 USDC, and an invoice already posted, are refused",
  ],
  refuse: [
    named["approval.sign"],
    "a signature that does not recover sam, an approval nobody issued and olga signing sam's are each refused, and nothing is sent",
  ],
  pay: [named["approval.sign"], "sam pays Brightside once from the company Safe, and a replay sends nothing more"],
  books: [named["report.run"], "the books agree with the chain: the payment posted once, and the invoice is paid"],
});

const sam = { as: "sam" } as const;
const SECOND_BILL = 40;
const TOO_MUCH = 5000;

export const payBrightside = journey(
  {
    name: "pay Brightside",
    story:
      "sam's payment to Brightside is held for his signature, wrong signatures are refused, sam pays once and a replay sends nothing more, and the books agree with the chain.",
    given: begins.paymentDrafted,
    steps,
  },
  Effect.gen(function* () {
    const facts = yield* given(begins.paymentDrafted);
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
        const poor = yield* op.refused(named["InsufficientBalance"], doc(Site.DOCTYPES.paymentEntry, big.name), sam);
        yield* sameAddress("the Safe that holds too little", poor.safe, companySafe);
        yield* same("what was asked and held", [Number(poor.amount), Number(poor.balance)], [TOO_MUCH, 1000]);
        yield* op.answers(named["Posted"], doc(Site.DOCTYPES.purchaseInvoice, bill.name), sam);
        const hold = yield* op.answers(named["Held"], doc(Site.DOCTYPES.paymentEntry, payment.name), sam);
        yield* same("the held payment's document hash", hold.payment.documentHash, payment.hash);
        yield* sameAmount("the held amount", hold.payment.amount.amount, Site.INVOICE_AMOUNT);
        yield* same("the payee", hold.payment.payee, supplier.name);
        yield* sameAddress(
          "the payee's address",
          hold.payment.payeeAddress,
          textOf(supplier.fields, Site.SUPPLIER_FIELDS.paymentAddress),
        );
        const posted = yield* op.refused(named["NotADraft"], doc(Site.DOCTYPES.purchaseInvoice, invoice.name), sam);
        yield* same("the posted invoice's docstatus", posted.docstatus, 1);
        return hold;
      }),
    );

    const brightside = textOf(supplier.fields, Site.SUPPLIER_FIELDS.paymentAddress);
    const bySam = yield* sign(held.approval);

    yield* steps.refuse.run((op) =>
      Effect.gen(function* () {
        const samIs = yield* castMember(world, "sam");
        const olga = yield* castMember(world, "olga");
        const invalid = yield* op.refused(named["SignatureInvalid"], yield* sign(held.approval, olga.signer), sam);
        yield* sameAddress("the address the wrong signature recovers", invalid.recovered, olga.signer);
        yield* sameAddress("the address it must recover", invalid.expected, samIs.signer);
        yield* op.refused(named["ApprovalNotFound"], { ...bySam, approval: "apr_nobodyissuedthis" }, sam);
        const notHers = yield* op.refused(named["NotYourApproval"], bySam, { as: "olga" });
        yield* same("whose approval it is", notHers.signer, "sam");
        yield* same("the payments sent so far", (yield* paymentsSent(world, held.payment.paymentId)).length, 0);
      }),
    );

    yield* steps.pay.run((op) =>
      Effect.gen(function* () {
        const before = yield* Effect.all([usdc(world, brightside), usdc(world, companySafe)]);
        const sent = yield* op.answers(named["Sent"], bySam, sam);
        yield* same("the subject sent", sent.subject, { kind: "payment", id: held.payment.request });
        const again = yield* op.answers(named["AlreadySent"], bySam, sam);
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
  }),
);
