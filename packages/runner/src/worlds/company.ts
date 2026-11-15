// The makers of the starting worlds with a company (decisions.md, 26 to 28, 38 to 41; step 1.12): `founded`,
// `office-holder`, `payment-drafted`, `payment-held` and `paid`, each made by its declaration's steps
// (packages/blueprint, src/starting-worlds.ts) through the door of the world the steps run in, from the one before.
// Every answer a step names becomes its fact, encoded as the blueprint encodes it.
//
// Signatures are made with the cast's keys, the blueprint's `CAST_KEYS`, as a person's agent would: the digest an
// approval names, signed as it is (decisions.md, 23 and 42), with viem (decisions.md, 34). A wait polls an operation
// until it answers differently (decisions.md, 27).
import { Site, Values, startingWorlds } from "@capxul/blueprint";
import { Capxul } from "@capxul/scenarios";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { mnemonicToAccount } from "viem/accounts";
import { describe, RunnerFailure } from "../failure.ts";
import { encodeAnswer } from "./encode.ts";
import type { Making, Steps } from "./makers.ts";

const failed = (message: string) => RunnerFailure.make({ step: "starting world", message });

/** A call of a maker that must succeed; any refusal fails the making with what came back. */
const must = <A, E, R>(what: string, call: Effect.Effect<A, E, R>) =>
  Effect.mapError(call, (error) => failed(`${what} was refused: ${describe(Cause.fail(error))}`));

/** An answer of the tag a step expects, or a failed making. */
const tagged = <A extends { readonly _tag: string }, T extends A["_tag"]>(what: string, answer: A, tag: T) =>
  Effect.fromOption(
    Option.liftPredicate(answer, (each): each is Extract<A, { readonly _tag: T }> => each._tag === tag),
  ).pipe(Effect.mapError(() => failed(`${what} answered ${answer._tag}, not ${tag}`)));

/** The door the steps run in: the world the starting world is made in. */
const doorOf = (making: Making) =>
  Effect.fromOption(Option.fromNullishOr(making.own)).pipe(
    Effect.mapError(() => failed("a company's starting world is made in a world, and none was made yet")),
  );

/** How `founded` founds Northwind (src/starting-worlds.ts): dana founds it with eli, 2 of 2, sam and pat, 1,000 USDC. */
const NORTHWIND = {
  handle: "northwind",
  profile: { name: "Northwind Trading", country: "NL", bio: null, size: null },
  directors: ["eli"],
  threshold: 2,
  members: ["sam", "pat"],
  capital: { asset: "USDC", amount: "1000" },
} as const;

/** The cast's well-known test keys (`CAST_KEYS`). */
const accounts = Effect.sync(() =>
  Arr.map(Arr.range(0, Values.CAST_KEYS.accounts - 1), (addressIndex) =>
    mnemonicToAccount(Values.CAST_KEYS.mnemonic, { addressIndex }),
  ),
);

type Approval = typeof Values.Approval.Type;

/** The approval's signer signs its digest with their own key, and approval.sign takes it as them, at `door`. */
const approve = (approval: Approval, door: string) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const key = Arr.findFirst(
      yield* accounts,
      (account) => Str.toLowerCase(account.address) === Str.toLowerCase(approval.signerAddress),
    );
    if (Option.isNone(key)) return yield* failed(`no test key signs as ${approval.signerAddress}`);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a digest is the blueprint's Hash: 0x and 64 hex digits, which viem names as a template type
    const digest = approval.digest as `0x${string}`;
    const signature = yield* Effect.promise(() => key.value.sign({ hash: digest }));
    return yield* must(
      `approval.sign of ${approval.id} as ${approval.signer}`,
      capxul["approval.sign"]({ approval: approval.id, signature }, { as: approval.signer, at: door }),
    );
  });

const approvalOf = (approvals: ReadonlyArray<Approval>, signer: string) =>
  Effect.fromOption(Arr.findFirst(approvals, (each) => each.signer === signer)).pipe(
    Effect.mapError(() => failed(`no approval for ${signer}`)),
  );

/** A wait for background work: one poll every two seconds, for at most ten minutes. */
const POLL = { schedule: Schedule.spaced(Duration.seconds(2)), times: 300 } as const;

/** Polls until `done`; an answer `stopped` gives a reason for ends the wait at once, as no later poll can be done. */
export const until = <A, E, R>(
  what: string,
  poll: Effect.Effect<A, E, R>,
  done: (answer: A) => boolean,
  stopped: (answer: A) => Option.Option<string> = () => Option.none(),
) =>
  poll.pipe(
    Effect.flatMap((answer) => {
      if (done(answer)) return Effect.succeed(Option.none<string>());
      const why = stopped(answer);
      return Option.isSome(why) ? Effect.succeed(why) : Effect.fail(failed(`waiting for ${what}`));
    }),
    Effect.retry(POLL),
    Effect.mapError(() => failed(`waited ten minutes for ${what}`)),
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.void,
        onSome: (why) => Effect.fail(failed(`stopped waiting for ${what}: ${why}`)),
      }),
    ),
  );

/** Why a wait for `org`'s site is over: a stopped site is never made again (as when the site door restarts mid-make). */
export const siteStopped =
  (org: string) =>
  (view: { readonly companies: ReadonlyArray<{ readonly org: string; readonly site: { readonly state: string } }> }) =>
    Option.map(
      Arr.findFirst(view.companies, (company) => company.org === org && company.site.state === "stopped"),
      (company) => `world.show lists ${company.org}'s site as stopped, which is never made again`,
    );

/** `founded`: dana founds Northwind; dana and eli sign its setup; the world shows its site ready. */
const founded: Steps = (making) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const own = yield* doorOf(making);
    const answer = yield* must("org.create as dana", capxul["org.create"](NORTHWIND, { as: "dana", at: own.door }));
    const made = yield* tagged("org.create as dana", answer, "Founded");
    const collected = yield* approve(yield* approvalOf(made.approvals, "dana"), own.door);
    const sent = yield* approve(yield* approvalOf(made.approvals, "eli"), own.door);
    yield* until(
      "world.show to list northwind's site as ready",
      must("world.show", capxul["world.show"]({ world: own.world })),
      (view) => Arr.some(view.companies, (company) => company.org === made.org && company.site.state === "ready"),
      siteStopped(made.org),
    );
    return {
      facts: {
        ...making.facts,
        founded: yield* encodeAnswer("org.create", made),
        setupCollected: yield* encodeAnswer("approval.sign", collected),
        setupSent: yield* encodeAnswer("approval.sign", sent),
      },
      own,
    };
  });

/** The org Northwind's founding made, from the facts. */
const orgOf = (making: Making) => {
  const founding = making.facts["founded"];
  return Predicate.hasProperty(founding, "org") && Predicate.isString(founding.org)
    ? Effect.succeed(founding.org)
    : Effect.fail(failed("the facts hold no founded org"));
};

/** report.run of the General Ledger as sam. */
const generalLedger = (org: string, door: string) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    return yield* capxul["report.run"](
      { org, report: Site.REPORTS.generalLedger, filters: {} },
      { as: "sam", at: door },
    );
  });

/** `office-holder`: dana grants sam manage-books, dana and eli sign it, and sam's site user appears. */
const officeHolder: Steps = (making) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const own = yield* doorOf(making);
    const org = yield* orgOf(making);
    const grant = yield* must(
      "org.member.grant as dana",
      capxul["org.member.grant"](
        { org, member: "sam", permission: "manage-books", note: null },
        { as: "dana", at: own.door },
      ),
    );
    const collected = yield* approve(yield* approvalOf(grant.approvals, "dana"), own.door);
    const sent = yield* approve(yield* approvalOf(grant.approvals, "eli"), own.door);
    yield* until(
      "report.run of the General Ledger as sam to stop refusing with NoSiteUser",
      Effect.exit(generalLedger(org, own.door)),
      (exit) => exit._tag === "Success",
    );
    return {
      facts: {
        ...making.facts,
        grant: yield* encodeAnswer("org.member.grant", grant),
        grantCollected: yield* encodeAnswer("approval.sign", collected),
        grantSent: yield* encodeAnswer("approval.sign", sent),
      },
      own,
    };
  });

/** sam's doc.create and doc.submit, at the door the steps run in. */
const asSam = (door: string) => ({ as: "sam", at: door }) as const;

/** The company Safe's ledger account, as the General Ledger names it: the account the founder's capital went to. */
const safeAccount = (org: string, door: string) =>
  Effect.gen(function* () {
    const ledger = yield* must("report.run of the General Ledger as sam", generalLedger(org, door));
    const account = Arr.findFirst(
      Arr.filter(
        Arr.map(ledger.rows, (row) => row[Site.ROW_FIELDS.account]),
        Predicate.isString,
      ),
      Str.startsWith(Site.SAFE_ACCOUNT_PREFIX),
    );
    if (Option.isNone(account))
      return yield* failed(`no General Ledger line on an account named ${Site.SAFE_ACCOUNT_PREFIX}…`);
    return account.value;
  });

/** `payment-drafted`: sam makes Brightside, its invoice (posted) and a draft payment of it from the Safe. */
const paymentDrafted: Steps = (making) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const own = yield* doorOf(making);
    const org = yield* orgOf(making);
    const create = (doctype: string, fields: typeof Values.Fields.Type) =>
      must(`doc.create of a ${doctype}`, capxul["doc.create"]({ org, doctype, fields }, asSam(own.door)));
    const supplier = yield* create(Site.DOCTYPES.supplier, Site.supplierFields(Site.BRIGHTSIDE));
    const invoice = yield* create(
      Site.DOCTYPES.purchaseInvoice,
      Site.invoiceFields(supplier.name, Site.INVOICE_AMOUNT),
    );
    const submitted = yield* must(
      "doc.submit of the Purchase Invoice",
      capxul["doc.submit"]({ org, doctype: Site.DOCTYPES.purchaseInvoice, name: invoice.name }, asSam(own.door)),
    );
    const posted = yield* tagged("doc.submit of the Purchase Invoice", submitted, "Posted");
    const account = yield* safeAccount(org, own.door);
    const payment = yield* create(
      Site.DOCTYPES.paymentEntry,
      Site.paymentFields(supplier.name, account, Site.INVOICE_AMOUNT, invoice.name),
    );
    return {
      facts: {
        ...making.facts,
        supplier: yield* encodeAnswer("doc.create", supplier),
        invoice: yield* encodeAnswer("doc.create", invoice),
        invoicePosted: yield* encodeAnswer("doc.submit", posted),
        payment: yield* encodeAnswer("doc.create", payment),
      },
      own,
    };
  });

/** The draft Payment Entry's name, from the facts. */
const paymentOf = (making: Making) => {
  const payment = making.facts["payment"];
  return Predicate.hasProperty(payment, "name") && Predicate.isString(payment.name)
    ? Effect.succeed(payment.name)
    : Effect.fail(failed("the facts hold no draft payment"));
};

/** `payment-held`: sam submits the Payment Entry, which is held for his signature. */
const paymentHeld: Steps = (making) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const own = yield* doorOf(making);
    const org = yield* orgOf(making);
    const name = yield* paymentOf(making);
    const submitted = yield* must(
      "doc.submit of the Payment Entry",
      capxul["doc.submit"]({ org, doctype: Site.DOCTYPES.paymentEntry, name }, asSam(own.door)),
    );
    const held = yield* tagged("doc.submit of the Payment Entry", submitted, "Held");
    return { facts: { ...making.facts, held: yield* encodeAnswer("doc.submit", held) }, own };
  });

/** `paid`: sam signs the held payment, which sends it, and the General Ledger shows the Payment Entry. */
const paid: Steps = (making) =>
  Effect.gen(function* () {
    const own = yield* doorOf(making);
    const org = yield* orgOf(making);
    const name = yield* paymentOf(making);
    const held = making.facts["held"];
    const decoded = yield* Schema.decodeUnknownEffect(Schema.toCodecJson(Values.Approval))(
      Predicate.hasProperty(held, "approval") ? held.approval : null,
    ).pipe(Effect.mapError(() => failed("the facts hold no held payment's approval")));
    const sent = yield* approve(decoded, own.door);
    yield* until(
      "report.run's General Ledger to show the Payment Entry",
      must("report.run of the General Ledger as sam", generalLedger(org, own.door)),
      (ledger) => Arr.some(ledger.rows, (row) => row[Site.ROW_FIELDS.voucher] === name),
    );
    return { facts: { ...making.facts, paidSent: yield* encodeAnswer("approval.sign", sent) }, own };
  });

/** The makers of the starting worlds with a company, by their names. */
export const companyMakers: Readonly<Record<string, Steps>> = {
  [startingWorlds.founded.name]: founded,
  [startingWorlds.officeHolder.name]: officeHolder,
  [startingWorlds.paymentDrafted.name]: paymentDrafted,
  [startingWorlds.paymentHeld.name]: paymentHeld,
  [startingWorlds.paid.name]: paid,
};
