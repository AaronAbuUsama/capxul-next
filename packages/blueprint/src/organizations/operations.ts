// The concept "organizations": founding a company and granting its members permissions. Both are served through a
// world's door, as the person named by the call. Neither waits for a signature: each answers with the approvals
// that must be signed, and `approval.sign` takes the signatures.
import * as Arr from "effect/Array";
import * as Str from "effect/String";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import {
  AlreadyHeld,
  ChangeWaiting,
  FounderNotReady,
  FoundingChanged,
  HandleTaken,
  InsufficientBalance,
  MemberHasNoSafe,
  NotADirector,
  NotAMember,
  OrgNotFound,
  PersonNotFound,
  SetupUnfinished,
  NotImplemented,
} from "../errors.ts";
import { declare, declareOutcomes, outcome } from "../operation.ts";
import {
  Address,
  Approval,
  ApprovalId,
  ChangeId,
  Money,
  OrgHandle,
  OrgId,
  Permission,
  PersonId,
  ProposalId,
} from "../values.ts";
import { exampleAddress as address } from "../world/example.ts";

/** A company was founded and its setup waits for its founding Directors' signatures. */
export class OrgFounded extends Schema.TaggedClass<OrgFounded, { readonly brand: unique symbol }>()("org_founded", {
  org: OrgId,
  handle: OrgHandle,
  safe: Address,
  founder: PersonId,
  approvals: Schema.Array(ApprovalId),
}) {}

/** A permission's change was proposed to the Directors. It carries neither the member nor the note. */
export class OfficerChangeProposed extends Schema.TaggedClass<
  OfficerChangeProposed,
  { readonly brand: unique symbol }
>()("officer_change_proposed", {
  change: ChangeId,
  org: OrgId,
  permission: Permission,
  proposal: ProposalId,
}) {}

/** A Directors' proposal was opened at the company Safe's next nonce. */
export class ProposalOpened extends Schema.TaggedClass<ProposalOpened, { readonly brand: unique symbol }>()(
  "proposal_opened",
  {
    proposal: ProposalId,
    org: OrgId,
    nonce: Schema.Int,
    threshold: Schema.Int,
    approvals: Schema.Array(ApprovalId),
  },
) {}

const Profile = Schema.Struct({
  name: Schema.Trim.check(Schema.isBetweenLength(1, 140)),
  country: Schema.String.check(Schema.isPattern(/^[A-Z]{2}$/)),
  bio: Schema.NullOr(Schema.Trim.check(Schema.isMaxLength(280))),
  size: Schema.NullOr(Schema.Trim.check(Schema.isMaxLength(40))),
});

const Board = Schema.Struct({
  /** Every founding Director, the founder first. */
  directors: Schema.Array(PersonId),
  /** How many Directors must sign a proposal. */
  threshold: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});

const Founding = Schema.Struct({
  handle: OrgHandle,
  profile: Profile,
  /** Founding Directors besides the founder, who is always one. */
  directors: Schema.Array(PersonId),
  threshold: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  /** Founding members: people seated in the company with no permission yet. */
  members: Schema.Array(PersonId),
  /** The founder's opening capital, moved from the founder's Safe to the company Safe when the setup is signed. */
  capital: Schema.NullOr(Money),
}).check(
  Schema.makeFilter(
    (founding) => founding.threshold <= founding.directors.length + 1 || "the threshold is more than the Directors",
  ),
);

/** The company is founded: its Safe is minted, and its setup waits for `board.threshold` of `approvals`. */
export class Founded extends Schema.TaggedClass<Founded, { readonly brand: unique symbol }>()("Founded", {
  org: OrgId,
  handle: OrgHandle,
  profile: Profile,
  safe: Address,
  founder: PersonId,
  founderSafe: Address,
  board: Board,
  members: Schema.Array(PersonId),
  capital: Schema.NullOr(Money),
  approvals: Schema.Array(Approval),
}) {}

/** The founder asked again with the same founding: the same company, as it stands. Nothing changed. */
export class Resumed extends Schema.TaggedClass<Resumed, { readonly brand: unique symbol }>()("Resumed", {
  org: OrgId,
  handle: OrgHandle,
  setup: Schema.Literals(["awaiting_signatures", "ready"]),
  /** The approvals not yet signed. */
  approvals: Schema.Array(Approval),
}) {}

const approval = (id: string, signer: string, n: number) => ({
  id,
  signer,
  signerAddress: address(n),
  digest: `0x${Str.repeat(32)("ab")}`,
  expiresAt: "2026-11-14T09:00:00Z",
});

const createRpc = Rpc.make("org.create", {
  payload: Founding,
  success: Schema.Union([Founded, Resumed]),
  error: Schema.Union([
    FounderNotReady,
    HandleTaken,
    FoundingChanged,
    SetupUnfinished,
    PersonNotFound,
    InsufficientBalance,
    NotImplemented,
  ]),
});

export const create = declareOutcomes({
  rpc: createRpc,
  outcomes: {
    Founded: outcome(createRpc, "Founded", [
      {
        event: OrgFounded,
        carries: ({ success }) => ({
          org: success.org,
          handle: success.handle,
          safe: success.safe,
          founder: success.founder,
          approvals: Arr.map(success.approvals, (each) => each.id),
        }),
      },
    ]),
    Resumed: outcome(createRpc, "Resumed", []),
  },
  budget: {
    ms: 8_000,
    excludes: ["waking a parked world"],
    provisional: true,
    basis:
      "two service-key transactions (the company Safe's mint and its deploy) on the world's own chain, then opening the approvals",
  },
  examples: [
    {
      payload: {
        handle: "northwind",
        profile: { name: "Northwind Trading", country: "NL", bio: null, size: null },
        directors: ["eli"],
        threshold: 2,
        members: ["sam", "pat"],
        capital: { asset: "USDC", amount: "1000" },
      },
      success: Founded.make({
        org: "org_northwind1",
        handle: "northwind",
        profile: { name: "Northwind Trading", country: "NL", bio: null, size: null },
        safe: address(21),
        founder: "dana",
        founderSafe: address(11),
        board: { directors: ["dana", "eli"], threshold: 2 },
        members: ["sam", "pat"],
        capital: { asset: "USDC", amount: "1000" },
        approvals: [approval("apr_setup1", "dana", 1), approval("apr_setup2", "eli", 2)],
      }),
    },
    {
      payload: {
        handle: "northwind",
        profile: { name: "Northwind Trading", country: "NL", bio: null, size: null },
        directors: ["eli"],
        threshold: 2,
        members: ["sam", "pat"],
        capital: { asset: "USDC", amount: "1000" },
      },
      success: Resumed.make({
        org: "org_northwind1",
        handle: "northwind",
        setup: "awaiting_signatures",
        approvals: [approval("apr_setup2", "eli", 2)],
      }),
    },
  ],
});

export const memberGrant = declare({
  rpc: Rpc.make("org.member.grant", {
    payload: {
      org: OrgId,
      member: PersonId,
      permission: Permission,
      /** What the Directors read when they approve. Kept with the proposal; never in an event. */
      note: Schema.NullOr(Schema.String.check(Schema.isMaxLength(500))),
    },
    success: Schema.Struct({
      change: Schema.Struct({
        id: ChangeId,
        member: PersonId,
        permission: Permission,
        state: Schema.Literal("proposed"),
      }),
      proposal: Schema.Struct({ id: ProposalId, nonce: Schema.Int, threshold: Schema.Int }),
      /** One approval per Director. The change is applied once `threshold` of them are signed and it executes. */
      approvals: Schema.Array(Approval),
    }),
    error: Schema.Union([
      OrgNotFound,
      NotADirector,
      NotAMember,
      AlreadyHeld,
      ChangeWaiting,
      MemberHasNoSafe,
      NotImplemented,
    ]),
  }),
  emits: [
    {
      event: OfficerChangeProposed,
      carries: ({ payload, success }) => ({
        change: success.change.id,
        org: payload.org,
        permission: payload.permission,
        proposal: success.proposal.id,
      }),
    },
    {
      event: ProposalOpened,
      carries: ({ payload, success }) => ({
        proposal: success.proposal.id,
        org: payload.org,
        nonce: success.proposal.nonce,
        threshold: success.proposal.threshold,
        approvals: Arr.map(success.approvals, (each) => each.id),
      }),
    },
  ],
  budget: {
    ms: 4_000,
    excludes: ["waking a parked world"],
    provisional: true,
    basis:
      "live reads of the Safe, Hats and the signer gate on the world's chain, then opening one approval per Director",
  },
  examples: [
    {
      payload: { org: "org_northwind1", member: "sam", permission: "manage-books", note: "Sam keeps the books" },
      success: {
        change: { id: "chg_books1", member: "sam", permission: "manage-books", state: "proposed" },
        proposal: { id: "prp_books1", nonce: 1, threshold: 2 },
        approvals: [approval("apr_books1", "dana", 1), approval("apr_books2", "eli", 2)],
      },
    },
  ],
});
