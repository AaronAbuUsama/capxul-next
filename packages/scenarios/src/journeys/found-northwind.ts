// Journey 2: found Northwind and give sam the books. dana founds the company with eli; who cannot found is refused;
// the Directors sign its setup and its site becomes ready; dana proposes that sam keep the books and the Directors
// sign it; sam's user reaches the site and he makes the company's first Supplier; then he is also given People.
import { Site, startingWorlds, type Values } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Str from "effect/String";
import { Capxul } from "../client.ts";
import { given } from "../expectation.ts";
import { journey, outline } from "../journey.ts";
import { usdc } from "../support/chain.ts";
import { refusal, same, sameAmount, sameInstant } from "../support/expect.ts";
import { decodedAsTyped, NORTHWIND_FOUNDING, type Founding, type TypedFounding } from "../support/founding.ts";
import { nowWears } from "../support/hats.ts";
import { castMember, company, NORTHWIND, recordOf, textOf } from "../support/world.ts";
import { approvalOf, sign, signedByBoard } from "./signatures.ts";

const steps = outline({
  cannot: [
    "org.create",
    "founders who cannot found, and payloads org.create's schema does not take, are refused, and nothing is made",
  ],
  found: [
    "org.create",
    "dana founds Northwind as she typed it, its bio and size trimmed; the same founding resumes it, and nobody founds it twice",
  ],
  setup: [
    "approval.sign",
    "dana's signature of the setup is kept and eli's sends it: the board and its capital are on the chain",
  ],
  ready: ["world.show", "Northwind's site becomes ready, and the world shows everything it was made with"],
  propose: [
    "org.member.grant",
    "dana proposes that sam keep the books; who may not ask, or be given it, is refused, and a second change waits",
  ],
  books: ["approval.sign", "dana's signature is kept and eli's executes the grant: sam's Safe wears the Books hat"],
  supplier: [
    "doc.create",
    "sam's user reaches the site and he makes Brightside; pat, a nameless Supplier and an Employee are refused",
  ],
  reports: [
    "report.run",
    "sam lists the Suppliers, only Brightside; pat, a payroll report and one that does not exist are refused",
  ],
  people: ["org.member.grant", "sam already keeps the books; dana proposes that he also manage people"],
  peopleHat: ["approval.sign", "dana and eli sign: sam's Safe wears the People hat"],
});

const dana = { as: "dana" } as const;
const sam = { as: "sam" } as const;
const PADDED_PROFILE = { ...NORTHWIND_FOUNDING.profile, bio: "  We keep offices clean.  ", size: "  2-10  " };
/** dana's founding as she types it, its bio and size padded with spaces: org.create's schema trims them as it decodes. */
const TYPED: TypedFounding = { ...NORTHWIND_FOUNDING, profile: PADDED_PROFILE };
/** The same spaces in a typed payload, which org.create's schema does not take: its typed side is trimmed text. */
const UNTRIMMED: Founding = { ...NORTHWIND_FOUNDING, profile: PADDED_PROFILE };

type Fields = typeof Values.Fields.Type;
const EMPLOYEE: Fields = {
  first_name: "Ada",
  last_name: "Lovelace",
  gender: "Female",
  date_of_birth: "1990-12-10",
  date_of_joining: "2026-11-01",
};

export const foundNorthwind = journey(
  {
    name: "found Northwind and give sam the books",
    story:
      "dana founds Northwind with eli, the Directors sign its setup, its site becomes ready, sam is given the books and makes its first Supplier, and then is also given People; everyone who may not is refused.",
    given: startingWorlds.fresh,
    steps,
  },
  Effect.gen(function* () {
    const { world } = yield* given(startingWorlds.fresh);
    const capxul = yield* Capxul;

    yield* steps.cannot.run((op) =>
      Effect.gen(function* () {
        yield* op.refused("FounderNotReady", { ...NORTHWIND_FOUNDING, members: ["sam"] }, { as: "pat" });
        const zed = yield* op.refused("PersonNotFound", { ...NORTHWIND_FOUNDING, directors: ["zed"] }, dana);
        const member = yield* op.refused("PersonNotFound", { ...NORTHWIND_FOUNDING, members: ["sam", "zed"] }, dana);
        yield* same("the people not found", [zed.person, member.person], ["zed", "zed"]);
        const poor = yield* op.refused(
          "InsufficientBalance",
          { ...NORTHWIND_FOUNDING, capital: { asset: "USDC", amount: "20000" } },
          dana,
        );
        yield* sameAmount("dana's balance", poor.balance, 10_000);
        const long = { ...NORTHWIND_FOUNDING, profile: { ...NORTHWIND_FOUNDING.profile, bio: Str.repeat(281)("b") } };
        yield* op.refused("PayloadRejected", long, dana);
        yield* op.refused("PayloadRejected", UNTRIMMED, dana);
      }),
    );

    const founded = yield* steps.found.run((op) =>
      Effect.gen(function* () {
        // Decoded by org.create's payload schema, as the command line decodes what a person types (claims.md,
        // org.create 6): the spaces never reach a typed payload, and what is sent is what must be stored.
        const typed = yield* decodedAsTyped(TYPED);
        const made = yield* op.answers("Founded", typed, dana);
        yield* same(
          "the stored bio and size",
          [made.profile.bio, made.profile.size],
          ["We keep offices clean.", "2-10"],
        );
        const resumed = yield* op.answers("Resumed", typed, dana);
        yield* same(
          "the resumed founding",
          [resumed.org, resumed.setup, Arr.map(resumed.approvals, (each) => each.id)],
          [made.org, "awaiting_signatures", Arr.map(made.approvals, (each) => each.id)],
        );
        const renamed = { ...typed, profile: { ...typed.profile, name: "Northwind Holdings" } };
        yield* op.refused("FoundingChanged", renamed, dana);
        yield* op.refused("HandleTaken", { ...typed, directors: ["dana"] }, { as: "eli" });
        const unfinished = yield* op.refused("SetupUnfinished", { ...typed, handle: "southwind" }, dana);
        yield* same("the founding unfinished", [unfinished.org, unfinished.handle], [made.org, NORTHWIND]);
        return made;
      }),
    );
    const org = founded.org;
    const create = (doctype: string, fields: Fields) => ({ org, doctype, fields });
    const report = (name: string) => ({ org, report: name, filters: {} });

    yield* steps.setup.run((op) =>
      Effect.gen(function* () {
        const kept = yield* op.answers("Collected", yield* sign(yield* approvalOf(founded.approvals, "dana")), dana);
        yield* same(
          "the setup after dana",
          [kept.signatures, kept.threshold, kept.subject],
          [1, 2, { kind: "org_setup", id: org }],
        );
        const sent = yield* op.answers("Sent", yield* sign(yield* approvalOf(founded.approvals, "eli")), { as: "eli" });
        yield* same("the subject eli's signature sent", sent.subject, kept.subject);
        const board = yield* capxul.chain.safe({ safe: founded.safe, block: null });
        const directors = yield* Effect.forEach(["dana", "eli"], (person) =>
          Effect.map(castMember(world, person), (member) => Str.toLowerCase(member.safe ?? "")),
        );
        yield* same(
          "the company Safe's owners and threshold",
          [Arr.sort(Arr.map(board.owners, Str.toLowerCase), Str.Order), board.threshold],
          [Arr.sort(directors, Str.Order), 2],
        );
        yield* sameAmount("the company Safe's USDC", yield* usdc(world, founded.safe), 1000);
        yield* sameAmount("dana's Safe's USDC", yield* usdc(world, founded.founderSafe), 9000);
      }),
    );

    yield* steps.ready.run((op) =>
      Effect.gen(function* () {
        const shown = yield* op.until("northwind's site ready", { world: world.world }, {}, (now) =>
          Arr.some(now.companies, (each) => each.handle === NORTHWIND && each.site.state === "ready"),
        );
        yield* same(
          "what the world was made with",
          [shown.owner, shown.grade, shown.door, shown.chainId, shown.contracts, shown.cast, shown.clock.mode],
          [world.owner, world.grade, world.door, world.chainId, world.contracts, world.cast, "frozen"],
        );
        yield* sameInstant("the expiry", shown.expiresAt, world.expiresAt);
        yield* same(
          "the companies",
          Arr.map(shown.companies, (each) => each.org),
          [org],
        );
        yield* same("the record head", shown.recordHead, (yield* recordOf()).head);
        yield* company(shown, NORTHWIND);
      }),
    );

    const books = yield* steps.propose.run((op) =>
      Effect.gen(function* () {
        const grant = (member: string, permission: "manage-books" | "issue-invoices" | "manage-people") => ({
          org,
          member,
          permission,
          note: null,
        });
        yield* op.refused("NotADirector", grant("sam", "issue-invoices"), sam);
        yield* op.refused("NotAMember", grant("olga", "issue-invoices"), dana);
        for (const permission of ["manage-books", "issue-invoices", "manage-people"] as const)
          yield* op.refused("MemberHasNoSafe", grant("pat", permission), dana);
        const proposed = yield* op.succeeds({ ...grant("sam", "manage-books"), note: "Sam keeps the books" }, dana);
        yield* same(
          "the approvals' signers",
          Arr.map(proposed.approvals, (each) => each.signer),
          ["dana", "eli"],
        );
        const waiting = yield* op.refused("ChangeWaiting", grant("sam", "issue-invoices"), dana);
        yield* same("the change waiting", waiting.change, proposed.change.id);
        yield* refusal(
          "doc.create as sam while the grant waits",
          "NoSiteUser",
          capxul["doc.create"](
            { org, doctype: Site.DOCTYPES.supplier, fields: Site.supplierFields(Site.BRIGHTSIDE) },
            sam,
          ),
        );
        return proposed;
      }),
    );

    yield* steps.books.run((op) =>
      signedByBoard(op, books.approvals, books.change.id).pipe(
        Effect.flatMap((sent) => nowWears(world, sent.transaction, "sam", "manage-books")),
      ),
    );

    yield* steps.supplier.run((op) =>
      Effect.gen(function* () {
        const brightside = create(Site.DOCTYPES.supplier, Site.supplierFields(Site.BRIGHTSIDE));
        yield* op.refused("NoSiteUser", brightside, { as: "pat" });
        const made = yield* op.whileRefused("NoSiteUser", brightside, sam);
        yield* same("Brightside's name", made.fields[Site.SUPPLIER_FIELDS.name], Site.BRIGHTSIDE);
        const nameless = { ...Site.supplierFields(Site.BRIGHTSIDE), [Site.SUPPLIER_FIELDS.name]: "" };
        const invalid = yield* op.refused("SiteRefused", create(Site.DOCTYPES.supplier, nameless), sam);
        yield* same("why the nameless Supplier was refused", invalid.reason, "validation");
        const denied = yield* op.refused("SiteRefused", create(Site.DOCTYPES.employee, EMPLOYEE), sam);
        yield* same("why the Employee was refused", denied.reason, "permission");
      }),
    );

    yield* steps.reports.run((op) =>
      Effect.gen(function* () {
        const suppliers = yield* op.succeeds(report(Site.REPORTS.supplierList), sam);
        yield* same(
          "the Suppliers",
          Arr.map(suppliers.rows, (row) => textOf(row, Site.SUPPLIER_FIELDS.name)),
          [Site.BRIGHTSIDE],
        );
        yield* op.refused("NoSiteUser", report(Site.REPORTS.generalLedger), { as: "pat" });
        const payroll = yield* op.refused("SiteRefused", report(Site.REPORTS.payroll), sam);
        yield* same("why the payroll report was refused", payroll.reason, "permission");
        const missing = yield* op.refused("SiteRefused", report("Ledger of Everything"), sam);
        yield* same("why a report that does not exist was refused", missing.reason, "not_found");
      }),
    );

    const people = yield* steps.people.run((op) =>
      Effect.gen(function* () {
        yield* op.refused("AlreadyHeld", { org, member: "sam", permission: "manage-books", note: null }, dana);
        return yield* op.succeeds({ org, member: "sam", permission: "manage-people", note: null }, dana);
      }),
    );

    yield* steps.peopleHat.run((op) =>
      signedByBoard(op, people.approvals, people.change.id).pipe(
        Effect.flatMap((sent) => nowWears(world, sent.transaction, "sam", "manage-people")),
      ),
    );
  }),
);
