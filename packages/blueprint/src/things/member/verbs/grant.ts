// `capxul member grant` (today `org.member.grant`): proposing a permission for a member.
import * as Arr from "effect/Array";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { verb, claim, kept, rewritten, dropped } from "@capxul/blueprint-tools";
import { NotImplemented, OrgNotFound } from "../../../common/refusals.ts";
import { OrgId, Permission, PersonId } from "../../../common/values.ts";
import { startingWorlds as w, type ClaimsOf } from "../../../starting-points/points.ts";
import { ProposalOpened } from "../../company/events.ts";
import { MemberHasNoSafe, NotADirector, NotAMember } from "../../company/refusals.ts";
import { OfficerChangeProposed } from "../events.ts";
import { samBooksGrant } from "../examples.ts";
import { AlreadyHeld, ChangeWaiting } from "../refusals.ts";
import { GrantProposed } from "../values.ts";

export const memberGrant = verb({
  rpc: Rpc.make("org.member.grant", {
    payload: {
      org: OrgId,
      member: PersonId,
      permission: Permission,
      /** What the Directors read when they approve. Kept with the proposal; never in an event. */
      note: Schema.NullOr(Schema.String.check(Schema.isMaxLength(500))),
    },
    success: GrantProposed,
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
      success: samBooksGrant,
    },
  ],
});

/** Who serves it: a world's Core, through the world's door (`WorldRpcs`). */
export const server = "world";

/** What `org.member.grant` promises, each promise checked by the journeys. */
export const promises: ClaimsOf = {
  operation: memberGrant,
  claims: [
    claim(
      "A grant is a Director proposal, applied once it executes.",
      w.founded,
      "org.member.grant as dana of manage-books to sam answers the change proposed and one approval each for dana and eli. approval.sign by dana answers Collected, 1 of 2; by eli, Sent for the officer change. Through the door's chain RPC (chain.transaction of what eli's signature sent) a hat is minted to sam's Safe, chain.hat gives its details as Books, and chain.wears says sam's Safe wears it; doc.create as sam stops refusing with NoSiteUser once his user reaches the site.",
      { origin: kept("org.member.grant/c-6412f20281167621"), thinLine: true },
    ),
    claim(
      "A caller who is not a Director, a person who is not a current member, and a grant of what the member holds are each refused.",
      w.officeHolder,
      "As sam it is refused with NotADirector; for olga, with NotAMember; manage-books for sam again, with AlreadyHeld. record.export shows no new entry.",
      {
        refusals: [NotADirector, NotAMember, AlreadyHeld],
        origin: rewritten(
          "org.member.grant/c-ed5a48c2e1b12719",
          "A caller who is not a Director, an email that is not a current Seat, and a grant of what the Seat holds are each refused.",
          'A member is named as a person of the world, not by email, and "Seat" is not a word of this contract.',
        ),
      },
    ),
    claim(
      "A second change is refused while one waits.",
      w.founded,
      "After a grant of manage-books to sam that nobody has signed, a grant of issue-invoices to sam is refused with ChangeWaiting naming the waiting change.",
      { refusals: [ChangeWaiting], origin: kept("org.member.grant/c-3e81e998390a6602") },
    ),
    claim(
      "It emits one officer_change_proposed, carrying neither the member nor the note.",
      w.founded,
      "The runner's events check finds exactly one officer_change_proposed with only change, org, permission and proposal: a recorded field more fails it.",
      {
        origin: rewritten(
          "org.member.grant/c-b8a4adcbed22e66d",
          "It reports one `officer_change_transitioned` (`propose`) for the proposing Director, carrying neither the Seat nor the note.",
          "Events are named for what happened, not for a state machine's transition.",
        ),
      },
    ),
    claim(
      "The proposal mints the officer hat to the member's Safe, and takes one more seat first when every seat is worn.",
      w.founded,
      "Through the door's chain RPC, the logs of the executed transaction (chain.transaction) from the world's Hats (`contracts.hats`) are a TransferSingle of the hat from the zero address to sam's Safe, which is what Hats.mintHat emits, preceded by a HatMaxSupplyChanged of the hat to its supply + 1 exactly when every seat of the hat was worn at the block before (chain.hat at that block).",
      {
        origin: rewritten(
          "org.member.grant/c-3254ec4a40c86a97",
          "The proposal mints the officer hat to the Seat's Safe, and takes one more seat first when every seat is worn.",
          '"Seat" is not a word of this contract.',
        ),
      },
    ),
    claim(
      "A member whose Safe already wears the hat, and a member with no personal Safe, are each refused before anything is proposed.",
      w.officeHolder,
      "manage-books for sam is refused with AlreadyHeld; any permission for pat is refused with MemberHasNoSafe. record.export shows no new entry.",
      {
        refusals: [AlreadyHeld, MemberHasNoSafe],
        origin: rewritten(
          "org.member.grant/c-7db203df47b9ca84",
          "A Seat whose Safe already wears the hat, and a Seat with no personal Safe, are each refused before anything is proposed.",
          '"Seat" is not a word of this contract.',
        ),
      },
    ),
    claim(
      "Manage people is the People hat.",
      w.founded,
      "After a grant of manage-people to sam is signed by dana and eli, sam's Safe wears (chain.wears) the hat the transaction minted to it, and chain.hat gives that hat's details as People (OFFICER_HAT_DETAILS).",
      { origin: kept("org.member.grant/c-640d6eb596538a6f") },
    ),
  ],
  dropped: [
    dropped(
      "org.member.grant/c-6fd22fa2a0774ed8",
      "With the Director proposals gate off it is refused, and Manage books needs the books gate too.",
      "Feature gates are not part of the thin line; they come back with the journey that switches parts on and off.",
    ),
  ],
};
