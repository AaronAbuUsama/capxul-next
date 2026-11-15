// Journey: seat sam on Northwind's Board. Northwind is as founded, dana and eli its Directors, 2 of 2. dana, its
// founder, whose Safe wears the Shareholders' top hat, seats sam as a third Director with her signature alone: his
// Safe wears the Director hat and signs the company Safe, still 2 of 3, and his user reaches the site. Then she makes
// the Board need all three, and a later grant asks sam too and is sent only by the third signature. Who may not
// change the Board, whom it cannot seat and what it cannot need are refused along the way.
import { Site, startingWorlds } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { Capxul, type Success } from "../client.ts";
import { given } from "../expectation.ts";
import { Cast } from "../cast.ts";
import { journey, outline } from "../journey.ts";
import { onChain, safesOf, seatedBy } from "../support/board.ts";
import { refusal, same } from "../support/expect.ts";
import { nowWears } from "../support/hats.ts";
import { emailOf, peopleOf, type Member } from "../support/people.ts";
import { approvalOf, sign } from "./signatures.ts";

const steps = outline({
  board: [
    "org.director.list",
    "Northwind's Board as founded: dana and eli, both must sign; olga, who belongs to no company, may not see it",
  ],
  seat: [
    "org.director.add",
    "who may not change the Board, and whom it cannot seat, are refused; dana proposes seating sam with her approval alone, and nothing else may change while it waits",
  ],
  seated: [
    "approval.sign",
    "eli may not sign dana's approval; hers lands the seat at once: sam's Safe wears the Director hat and signs the company Safe, 2 of 3",
  ],
  three: [
    "org.director.list",
    "Northwind's Board is dana, eli and sam, 2 of 3, as sam sees it and as the world's owner",
  ],
  site: ["report.run", "sam's user reaches the site as a Director and he reads the General Ledger; pat still has none"],
  threshold: [
    "org.threshold.set",
    "sam may not set it, and no threshold the Board cannot meet or already has is taken; dana proposes 3 of 3, and nothing else while it waits",
  ],
  raised: ["approval.sign", "dana's signature lands it: the company Safe needs all three Directors"],
  propose: [
    "org.member.grant",
    "dana proposes that sam keep the books: all three Directors are asked, and 3 must sign",
  ],
  books: [
    "approval.sign",
    "dana's and eli's signatures are kept, 2 of 3 no longer enough; sam's executes it, and his Safe wears the Books hat",
  ],
});

/** A company nobody founded. */
const NO_ORG = "org_nowhere1";

/** Who a list names, and how many must sign. */
const named = (listed: Success<"org.director.list">) => [
  Arr.map(listed.directors, (each) => each.person),
  listed.threshold,
];

export const seatSam = journey(
  {
    name: "seat sam on Northwind's Board",
    world: "shared",
    key: "seat",
    story:
      "dana, Northwind's founder, seats sam as its third Director with her signature alone, so he signs the company Safe and has a user on its site, then makes the Board need all three, and a grant is sent only by sam's signature; everyone who may not is refused.",
    given: startingWorlds.founded,
    steps,
  },
  Effect.gen(function* () {
    const cast = yield* Cast;
    const dana = { as: cast.dana } as const;
    const eli = { as: cast.eli } as const;
    const sam = { as: cast.sam } as const;
    const pat = { as: cast.pat } as const;
    const { world, founded } = yield* given(startingWorlds.founded);
    const capxul = yield* Capxul;
    const org = founded.org;
    const founders = [cast.dana, cast.eli];
    const three = [...founders, cast.sam];
    const ledger = { org, report: Site.REPORTS.generalLedger, filters: {} };

    const before = yield* steps.board.run((op) =>
      Effect.gen(function* () {
        const listed = yield* op.succeeds({ org }, dana);
        yield* same("Northwind's Board as founded", named(listed), [founders, 2]);
        const owned = yield* op.succeeds({ org });
        yield* same("Northwind's Board as the world's owner sees it", owned, listed);
        yield* op.refused("NotAMember", { org }, { as: cast.olga });
        yield* op.refused("OrgNotFound", { org: NO_ORG }, dana);
        return listed;
      }),
    );

    const seat = yield* steps.seat.run((op) =>
      Effect.gen(function* () {
        for (const caller of [sam, eli]) {
          const refused = yield* op.refused("CannotChangeBoard", { org, person: cast.sam }, caller);
          yield* same("who may not change the Board", refused.person, caller.as);
        }
        yield* op.refused("NotAMember", { org, person: cast.olga }, dana);
        yield* op.refused("MemberHasNoSafe", { org, person: cast.pat }, dana);
        yield* op.refused("AlreadyADirector", { org, person: cast.eli }, dana);
        yield* op.refused("OrgNotFound", { org: NO_ORG, person: cast.sam }, dana);
        const proposed = yield* op.succeeds({ org, person: cast.sam }, dana);
        yield* same(
          "the seat proposed",
          [proposed.change.person, proposed.change.before, proposed.change.after, proposed.approval.signer],
          [cast.sam, { directors: 2, threshold: 2 }, { directors: 3, threshold: 2 }, cast.dana],
        );
        const waiting = yield* op.refused("BoardChangeWaiting", { org, person: cast.sam }, dana);
        yield* same("the change waiting", waiting.change, proposed.change.id);
        yield* refusal("report.run as sam while his seat waits", "NoSiteUser", capxul["report.run"](ledger, sam));
        return proposed;
      }),
    );

    yield* steps.seated.run((op) =>
      Effect.gen(function* () {
        yield* op.refused("NotYourApproval", yield* sign(seat.approval), eli);
        const sent = yield* op.answers("Sent", yield* sign(seat.approval), dana);
        yield* same("the subject dana's signature sent", sent.subject, { kind: "board_change", id: seat.change.id });
        const seated = yield* seatedBy(world, sent.transaction, cast.sam);
        yield* same("the Director hat sam's Safe now wears", seated.hat, before.directorHat);
        yield* same("the company Safe's owners and threshold", yield* onChain(founded.safe), {
          owners: yield* safesOf(world, three),
          threshold: 2,
        });
        const person = (who: string, role: Member["role"]): Member => ({
          person: who,
          email: emailOf(world, who),
          role,
        });
        yield* same("Northwind's people once sam is seated", yield* peopleOf(org), [
          ...Arr.map(three, (each) => person(each, "director")),
          person(cast.pat, "member"),
        ]);
      }),
    );

    yield* steps.three.run((op) =>
      Effect.gen(function* () {
        const seen = yield* op.succeeds({ org }, sam);
        yield* same("Northwind's Board as sam sees it", named(seen), [three, 2]);
        const owned = yield* op.succeeds({ org });
        yield* same("Northwind's Board as the world's owner sees it", owned, seen);
      }),
    );

    yield* steps.site.run((op) =>
      Effect.gen(function* () {
        yield* op.refused("NoSiteUser", ledger, pat);
        yield* op.whileRefused("NoSiteUser", ledger, sam);
      }),
    );

    const raise = yield* steps.threshold.run((op) =>
      Effect.gen(function* () {
        const refused = yield* op.refused("CannotChangeBoard", { org, threshold: 3 }, sam);
        yield* same("who may not set the threshold", refused.person, cast.sam);
        yield* op.refused("PayloadRejected", { org, threshold: 0 }, dana);
        const high = yield* op.refused("ThresholdTooHigh", { org, threshold: 4 }, dana);
        yield* same("the threshold refused, and the Directors", [high.threshold, high.directors], [4, 3]);
        yield* op.refused("ThresholdUnchanged", { org, threshold: 2 }, dana);
        yield* op.refused("OrgNotFound", { org: NO_ORG, threshold: 3 }, dana);
        const proposed = yield* op.succeeds({ org, threshold: 3 }, dana);
        yield* same(
          "the threshold proposed",
          [proposed.change.before, proposed.change.after, proposed.approval.signer],
          [{ directors: 3, threshold: 2 }, { directors: 3, threshold: 3 }, cast.dana],
        );
        const waiting = yield* op.refused("BoardChangeWaiting", { org, threshold: 1 }, dana);
        yield* same("the change waiting", waiting.change, proposed.change.id);
        return proposed;
      }),
    );

    yield* steps.raised.run((op) =>
      Effect.gen(function* () {
        const sent = yield* op.answers("Sent", yield* sign(raise.approval), dana);
        yield* same("the subject dana's signature sent", sent.subject, { kind: "board_change", id: raise.change.id });
        yield* same("the company Safe's owners and threshold", yield* onChain(founded.safe), {
          owners: yield* safesOf(world, three),
          threshold: 3,
        });
        const listed = yield* capxul["org.director.list"]({ org }, dana);
        yield* same("Northwind's Board once all three must sign", named(listed), [three, 3]);
      }),
    );

    const books = yield* steps.propose.run((op) =>
      Effect.gen(function* () {
        const proposed = yield* op.succeeds({ org, member: cast.sam, permission: "manage-books", note: null }, dana);
        yield* same(
          "the Directors asked, and how many must sign",
          [Arr.map(proposed.approvals, (each) => each.signer), proposed.proposal.threshold],
          [[cast.dana, cast.eli, cast.sam], 3],
        );
        return proposed;
      }),
    );

    yield* steps.books.run((op) =>
      Effect.gen(function* () {
        const subject = { kind: "officer_change", id: books.change.id } as const;
        const first = yield* op.answers("Collected", yield* sign(yield* approvalOf(books.approvals, cast.dana)), dana);
        yield* same("the grant after dana", [first.signatures, first.threshold, first.subject], [1, 3, subject]);
        const second = yield* op.answers("Collected", yield* sign(yield* approvalOf(books.approvals, cast.eli)), eli);
        yield* same("the grant after eli", [second.signatures, second.threshold], [2, 3]);
        const sent = yield* op.answers("Sent", yield* sign(yield* approvalOf(books.approvals, cast.sam)), sam);
        yield* same("the subject sam's signature sent", sent.subject, subject);
        yield* nowWears(world, sent.transaction, cast.sam, "manage-books");
      }),
    );
  }),
);
