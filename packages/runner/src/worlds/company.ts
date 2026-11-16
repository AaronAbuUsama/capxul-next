// The makers of the starting worlds with a company (packages/blueprint, src/things/company/verbs/create.ts,
// src/starting-points/points.ts, src/things/document/verbs/submit.ts, src/starting-points/facts.ts and
// src/common/site.ts; step 1.12): `founded`, `office-holder`, `payment-drafted`, `payment-held` and `paid`, each made
// by its declaration's steps (src/starting-points/points.ts) through the door of the world the steps run in, from the
// one before. Every answer a step names becomes its fact, encoded as the blueprint encodes it.
//
// Signatures are made with the cast's keys, the blueprint's `CAST_KEYS`, as a person's agent would: the digest an
// approval names, signed as it is (src/things/approval/values.ts and src/common/values.ts), with viem
// (src/common/chain/reads.ts). A wait polls an operation until it answers differently (points.ts; wait.ts).
import { Cast, Site, Values, startingWorlds } from "@capxul/blueprint";
import { Capxul, Casting, type Casted } from "@capxul/scenarios";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { mnemonicToAccount } from "viem/accounts";
import { describe, RunnerFailure } from "../failure.ts";
import { encodeAnswer } from "./encode.ts";
import { JourneyMaking } from "./journey-making.ts";
import type { Making, Steps } from "./makers.ts";
import { seenExit, siteReading, until } from "./wait.ts";

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

/** Who plays each role in the starting world being made, and its company's handle (scenarios' cast.ts). */
type Players = Casted["people"] & { readonly company: string };

/** Each role by the person of its name, and the story's company: one journey after another, as before. */
const UNCAST: Players = { dana: "dana", eli: "eli", sam: "sam", pat: "pat", olga: "olga", company: Cast.CAST_COMPANY };

/**
 * The players of the journey whose starting world is being made: its own cast, when the run casts every journey
 * (`Casting`, a run in one shared world, side-by-side.ts), so journeys side by side never found the same company or
 * share a person's Safe; otherwise each role by its own name.
 */
const playersNow: Effect.Effect<Players> = Effect.gen(function* () {
  const making = yield* Effect.serviceOption(JourneyMaking);
  const casting = yield* Effect.serviceOption(Casting);
  const journey = Option.flatMap(making, (each) => Option.fromNullishOr(each.journey));
  if (Option.isNone(journey) || Option.isNone(casting)) return UNCAST;
  const casted = yield* casting.value.castOf(journey.value.key);
  return { ...casted.people, company: casted.company };
});

/**
 * How `founded` founds Northwind (packages/blueprint, src/starting-points/points.ts): dana founds it with eli, 2 of 2,
 * sam and pat, 1,000 USDC; each played by the journey's cast, the company under its handle.
 */
const northwindOf = (players: Players) =>
  ({
    handle: players.company,
    profile: { name: "Northwind Trading", country: "NL", bio: null, size: null },
    directors: [players.eli],
    threshold: 2,
    members: [players.sam, players.pat],
    capital: { asset: "USDC", amount: "1000" },
  }) as const;

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

/** `founded`: dana founds Northwind; dana and eli sign its setup; the world shows its site ready. */
const founded: Steps = (making) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const own = yield* doorOf(making);
    const players = yield* playersNow;
    const answer = yield* must(
      "org.create as dana",
      capxul["org.create"](northwindOf(players), { as: players.dana, at: own.door }),
    );
    const made = yield* tagged("org.create as dana", answer, "Founded");
    const collected = yield* approve(yield* approvalOf(made.approvals, players.dana), own.door);
    const sent = yield* approve(yield* approvalOf(made.approvals, players.eli), own.door);
    yield* until(
      "world.show to list northwind's site as ready",
      must("world.show", capxul["world.show"]({ world: own.world })),
      (view) => Arr.some(view.companies, (company) => company.org === made.org && company.site.state === "ready"),
      siteReading(made.org),
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

/** report.run of the General Ledger as sam, played by `sam`. */
const generalLedger = (org: string, door: string, sam: string) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    return yield* capxul["report.run"]({ org, report: Site.REPORTS.generalLedger, filters: {} }, { as: sam, at: door });
  });

/** `office-holder`: dana grants sam manage-books, dana and eli sign it, and sam's site user appears. */
const officeHolder: Steps = (making) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const own = yield* doorOf(making);
    const org = yield* orgOf(making);
    const players = yield* playersNow;
    const grant = yield* must(
      "org.member.grant as dana",
      capxul["org.member.grant"](
        { org, member: players.sam, permission: "manage-books", note: null },
        { as: players.dana, at: own.door },
      ),
    );
    const collected = yield* approve(yield* approvalOf(grant.approvals, players.dana), own.door);
    const sent = yield* approve(yield* approvalOf(grant.approvals, players.eli), own.door);
    yield* until(
      "report.run of the General Ledger as sam to stop refusing with NoSiteUser",
      Effect.exit(generalLedger(org, own.door, players.sam)),
      (exit) => exit._tag === "Success",
      { seen: seenExit },
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

/** sam's doc.create and doc.submit, at the door the steps run in, sam played by `sam`. */
const asSam = (door: string, sam: string) => ({ as: sam, at: door }) as const;

/** The company Safe's ledger account, as the General Ledger names it: the account the founder's capital went to. */
const safeAccount = (org: string, door: string, sam: string) =>
  Effect.gen(function* () {
    const ledger = yield* must("report.run of the General Ledger as sam", generalLedger(org, door, sam));
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
    const players = yield* playersNow;
    const create = (doctype: string, fields: typeof Values.Fields.Type) =>
      must(`doc.create of a ${doctype}`, capxul["doc.create"]({ org, doctype, fields }, asSam(own.door, players.sam)));
    const supplier = yield* create(Site.DOCTYPES.supplier, Site.supplierFields(Site.BRIGHTSIDE));
    const invoice = yield* create(
      Site.DOCTYPES.purchaseInvoice,
      Site.invoiceFields(supplier.name, Site.INVOICE_AMOUNT),
    );
    const submitted = yield* must(
      "doc.submit of the Purchase Invoice",
      capxul["doc.submit"](
        { org, doctype: Site.DOCTYPES.purchaseInvoice, name: invoice.name },
        asSam(own.door, players.sam),
      ),
    );
    const posted = yield* tagged("doc.submit of the Purchase Invoice", submitted, "Posted");
    const account = yield* safeAccount(org, own.door, players.sam);
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
    const players = yield* playersNow;
    const submitted = yield* must(
      "doc.submit of the Payment Entry",
      capxul["doc.submit"]({ org, doctype: Site.DOCTYPES.paymentEntry, name }, asSam(own.door, players.sam)),
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
    const players = yield* playersNow;
    const held = making.facts["held"];
    const decoded = yield* Schema.decodeUnknownEffect(Schema.toCodecJson(Values.Approval))(
      Predicate.hasProperty(held, "approval") ? held.approval : null,
    ).pipe(Effect.mapError(() => failed("the facts hold no held payment's approval")));
    const sent = yield* approve(decoded, own.door);
    yield* until(
      "report.run's General Ledger to show the Payment Entry",
      must("report.run of the General Ledger as sam", generalLedger(org, own.door, players.sam)),
      (ledger) => Arr.some(ledger.rows, (row) => row[Site.ROW_FIELDS.voucher] === name),
      { seen: (ledger) => `a General Ledger of ${ledger.rows.length} rows, none of ${name}` },
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
