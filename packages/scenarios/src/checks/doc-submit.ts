// The checks of every doc.submit (claims.md, doc.submit 1 to 4, doc.create 4): an ordinary document posts, and the
// General Ledger shows its lines, which balance; a payment from the company Safe is held, not posted, for its signer
// (the caller, at their own signer address), carrying the hash doc.create gave the document; a document that is not
// a draft, and a payment of more than the Safe holds, are refused, and nothing is held or recorded.
import { operations, Site, type Values } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { expect } from "../expectation.ts";
import { Journal } from "../journal.ts";
import { usdc } from "../support/chain.ts";
import { same, sameAddress, sameAmount, show } from "../support/expect.ts";
import { ledger, linesOf, numberOf } from "../support/site.ts";
import { entriesOfCall } from "../support/world.ts";
import { callerIn, namesCaller, nothingRecorded, worldBefore, type Before } from "./common.ts";
import { check, checks, type Asked } from "./format.ts";

type Asking = Asked<"doc.submit">;

const isCreated = Schema.is(operations["doc.create"].rpc.successSchema);

/** The hash doc.create answered for the document, when one of the journey's steps created it. */
const createdHash = (asked: Asking) =>
  Effect.gen(function* () {
    const journal = yield* Journal;
    const made = yield* Ref.get(journal.made);
    const created = Arr.findLast(
      Arr.filterMap(made, (each) =>
        each.operation === "doc.create" && isCreated(each.success) ? Result.succeed(each.success) : Result.failVoid,
      ),
      (answer) => answer.doctype === asked.payload.doctype && answer.name === asked.payload.name,
    );
    return Option.getOrNull(Option.map(created, (answer) => answer.hash));
  });

/** The document's lines in the General Ledger, read as the caller. */
const linesFor = (asked: Asking) =>
  Effect.map(ledger(asked.payload.org, {}, asked.options), (rows) => linesOf(rows, asked.payload.name));

const sumOf = (rows: ReadonlyArray<typeof Values.Fields.Type>, field: string) =>
  Arr.reduce(rows, 0, (sum, row) => sum + numberOf(row[field]));

export const docSubmit = checks<"doc.submit", Before>({
  before: (asked) => worldBefore(asked.options),
  success: (asked, answer, before) => {
    const named = check(
      "it answers the document asked",
      same("the document", [answer.doctype, answer.name], [asked.payload.doctype, asked.payload.name]),
    );
    if (answer._tag === "Posted")
      return [
        named,
        check(
          "it posts: the General Ledger shows its lines, which balance",
          Effect.gen(function* () {
            const lines = yield* linesFor(asked);
            yield* expect(lines.length >= 2, `the General Ledger shows ${lines.length} lines for ${answer.name}`);
            yield* sameAmount(
              `${answer.name}'s credits against its debits`,
              sumOf(lines, Site.ROW_FIELDS.credit),
              sumOf(lines, Site.ROW_FIELDS.debit),
            );
          }),
        ),
        check(
          "the record gains its doc_submitted",
          Effect.flatMap(entriesOfCall(before.head, before.where), (added) =>
            same(
              "the events the submit added",
              Arr.map(added, (entry) => entry.event),
              ["doc_submitted"],
            ),
          ),
        ),
      ];
    return [
      named,
      check(
        "it is held for the caller, who signs at their own signer address",
        Effect.gen(function* () {
          const signer = yield* callerIn(before, asked.options);
          yield* same("the held payment's signer", answer.approval.signer, signer.person);
          yield* sameAddress("the signer's address", answer.approval.signerAddress, signer.signer);
          yield* same("the held payment's asset", answer.payment.amount.asset, "USDC");
          yield* expect(answer.payment.paymentId !== "", "the held payment has no paymentId");
        }),
      ),
      check(
        "it carries the hash doc.create gave the document",
        Effect.flatMap(createdHash(asked), (hash) =>
          hash === null ? Effect.void : same("the held payment's document hash", answer.payment.documentHash, hash),
        ),
      ),
      check(
        "nothing is posted for it yet",
        Effect.flatMap(linesFor(asked), (lines) =>
          expect(lines.length === 0, `the General Ledger shows the held payment: ${show(lines)}`),
        ),
      ),
      check(
        "the record gains its payment_held",
        Effect.flatMap(entriesOfCall(before.head, before.where), (added) =>
          same(
            "the events the submit added",
            Arr.map(added, (entry) => entry.event),
            ["payment_held"],
          ),
        ),
      ),
    ];
  },
  refusals: {
    NotADraft: (asked, refused, before) => [
      check(
        "NotADraft names the document asked, which is not a draft",
        Effect.gen(function* () {
          yield* same("NotADraft", [refused.doctype, refused.name], [asked.payload.doctype, asked.payload.name]);
          yield* expect(refused.docstatus !== 0, "NotADraft names a draft");
        }),
      ),
      nothingRecorded("the refused submit", before),
    ],
    InsufficientBalance: (asked, refused, before) => [
      check(
        "InsufficientBalance names a Safe, what it holds of USDC, and an amount of more",
        Effect.gen(function* () {
          yield* same("InsufficientBalance's asset", refused.asset, "USDC");
          yield* sameAmount(
            "InsufficientBalance's balance",
            refused.balance,
            yield* usdc(before.world, refused.safe, before.where),
          );
          yield* expect(Number(refused.amount) > Number(refused.balance), "the amount is not more than held");
        }),
      ),
      nothingRecorded("the refused payment", before),
    ],
    NoSiteUser: (asked, refused, before) => [
      check("NoSiteUser names the company asked", same("its org", refused.org, asked.payload.org)),
      namesCaller("NoSiteUser", refused.person, asked.options),
      nothingRecorded("the refused submit", before),
    ],
    SiteRefused: (asked, refused, before) => [
      check(
        "SiteRefused names the company and the doctype asked",
        same("SiteRefused", [refused.org, refused.target], [asked.payload.org, asked.payload.doctype]),
      ),
      nothingRecorded("the refused submit", before),
    ],
  },
});
