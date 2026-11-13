// doc.create, doc.submit and report.run: a company's documents and reports on its site, run as the caller's own site
// user through the Capxul app's `capxul.core_api` (sites.ts). A caller with no site user is refused `NoSiteUser`, the
// site's own refusals are `SiteRefused` with their reason, and nothing is run as anyone else. A successful call keeps
// exactly the events its declaration computes (record.ts).
import { CurrentCall, CurrentCaller, Documents, Errors, Reports, Values } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Cast } from "./cast.ts";
import { DocumentHashes } from "./hashes.ts";
import { PaymentApprovals } from "./payments.ts";
import { WorldRecord } from "./record.ts";
import { answerOf, CompanySites, unexpected, type SiteRefusal } from "./sites.ts";

type Fields = typeof Values.Fields.Type;

/** Who the call acts for on the site: the person and their site user's email. The world's owner has none there. */
const siteUser = Effect.gen(function* () {
  const caller = yield* CurrentCaller;
  if (caller._tag === "owner") return { person: caller.owner, email: null };
  const cast = yield* Cast;
  return { person: caller.person, email: Option.getOrNull(yield* cast.emailOf(caller.person)) };
});

/** The site's refusals of a document or a report, as the blueprint's. */
const refusedBy =
  (org: string, person: string) =>
  (refusal: SiteRefusal): Effect.Effect<never, Errors.NoSiteUser | Errors.SiteRefused> => {
    if (refusal.refused === "no-site-user") return Effect.fail(Errors.NoSiteUser.make({ org, person }));
    if (refusal.refused === "site-refused")
      return Effect.fail(
        Errors.SiteRefused.make({ org, target: refusal.target, reason: refusal.reason, message: refusal.message }),
      );
    return unexpected(refusal);
  };

/** A submit's refusals: those of any document, and `NotADraft` for one that is not a draft. */
const submitRefusedBy =
  (org: string, person: string, document: { readonly doctype: string; readonly name: string }) =>
  (refusal: SiteRefusal): Effect.Effect<never, Errors.NoSiteUser | Errors.SiteRefused | Errors.NotADraft> =>
    refusal.refused === "not-a-draft"
      ? Effect.fail(Errors.NotADraft.make({ ...document, docstatus: refusal.docstatus }))
      : refusedBy(org, person)(refusal);

const Created = Documents.create.rpc.successSchema;

export const docCreate = (payload: { readonly org: string; readonly doctype: string; readonly fields: Fields }) =>
  Effect.gen(function* () {
    const { org, doctype, fields } = payload;
    const who = yield* siteUser;
    const sites = yield* CompanySites;
    const answer = yield* sites.call(org, "create", { user: who.email, doctype, fields });
    const success = yield* answerOf(Created, answer, refusedBy(org, who.person));
    const hashes = yield* DocumentHashes;
    yield* hashes.keep(
      { org, doctype: success.doctype, name: success.name },
      success.hash,
      (yield* CurrentCall).traceId,
    );
    yield* Effect.flatMap(Effect.service(WorldRecord), (record) => record.emit(Documents.create, { payload, success }));
    return success;
  });

/** What the site answers a submit: the document posted, or a payment from the Safe, read and not yet held. */
const Submitted = Schema.Union([
  Schema.Struct({
    posted: Schema.Struct({ doctype: Schema.String, name: Schema.String, docstatus: Schema.Literal(1) }),
  }),
  Schema.Struct({
    payment: Schema.Struct({
      payee: Schema.String,
      payee_address: Values.Address,
      amount: Values.Amount,
      asset: Values.Asset,
      safe: Values.Address,
      document_hash: Values.Hash,
    }),
  }),
]);
const HeldOnSite = Schema.Struct({ held: Schema.Struct({ name: Schema.String, docstatus: Schema.Literal(0) }) });

export const docSubmit = (payload: { readonly org: string; readonly doctype: string; readonly name: string }) =>
  Effect.gen(function* () {
    const { org, doctype, name } = payload;
    const who = yield* siteUser;
    const sites = yield* CompanySites;
    const record = yield* WorldRecord;
    const refused = submitRefusedBy(org, who.person, { doctype, name });
    const submitted = yield* answerOf(
      Submitted,
      yield* sites.call(org, "submit", { user: who.email, doctype, name }),
      refused,
    );
    if ("posted" in submitted) {
      const posted = Documents.Posted.make(submitted.posted);
      yield* record.emit(Documents.submit, { payload, success: posted });
      return posted;
    }
    // The hold (decisions.md, 28): the payee, the amount and the asset from the Payment Entry, the payee's address
    // from the Supplier, and the document's hash as doc.create stored it.
    const { payment } = submitted;
    const stored = yield* Effect.flatMap(Effect.service(DocumentHashes), (hashes) => hashes.of({ org, doctype, name }));
    const documentHash = Option.getOrElse(stored, () => payment.document_hash);
    const approvals = yield* PaymentApprovals;
    const opened = yield* approvals.open({
      org,
      person: who.person,
      document: { doctype, name },
      payee: payment.payee,
      payeeAddress: payment.payee_address,
      amount: { asset: payment.asset, amount: payment.amount },
      safe: payment.safe,
      documentHash,
    });
    const hold = yield* sites.call(org, "hold", {
      user: who.email,
      name,
      document_hash: documentHash,
      request: opened.request,
      approval: opened.approval.id,
      payment_id: opened.paymentId,
    });
    yield* answerOf(HeldOnSite, hold, refused);
    const held = Documents.Held.make({
      doctype,
      name,
      docstatus: 0,
      payment: {
        request: opened.request,
        amount: { asset: payment.asset, amount: payment.amount },
        payee: payment.payee,
        payeeAddress: payment.payee_address,
        documentHash,
        paymentId: opened.paymentId,
      },
      approval: opened.approval,
    });
    yield* record.emit(Documents.submit, { payload, success: held });
    return held;
  });

const Ran = Reports.run.rpc.successSchema;

export const reportRun = (payload: { readonly org: string; readonly report: string; readonly filters: Fields }) =>
  Effect.gen(function* () {
    const { org, report, filters } = payload;
    const who = yield* siteUser;
    const sites = yield* CompanySites;
    const answer = yield* sites.call(org, "report", { user: who.email, report, filters });
    return yield* answerOf(Ran, answer, refusedBy(org, who.person));
  });
