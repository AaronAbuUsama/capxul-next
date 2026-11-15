// `capxul director add` (today `org.director.add`): seating a member as a Director.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { verb, claim } from "@capxul/blueprint-tools";
import { NotImplemented, OrgNotFound } from "../../../common/refusals.ts";
import { OrgId, PersonId } from "../../../common/values.ts";
import { startingWorlds as w, type ClaimsOf } from "../../../starting-points/points.ts";
import { BoardChangeProposed } from "../../board/events.ts";
import { proposed } from "../../board/values.ts";
import { founderApproval } from "../../board/examples.ts";
import { BoardChangeWaiting, CannotChangeBoard } from "../../board/refusals.ts";
import { Proposed } from "../../board/values.ts";
import { MemberHasNoSafe, NotAMember } from "../../company/refusals.ts";
import { AlreadyADirector } from "../refusals.ts";

export const directorAdd = verb({
  rpc: Rpc.make("org.director.add", {
    payload: { org: OrgId, person: PersonId },
    success: Proposed,
    error: Schema.Union([
      OrgNotFound,
      CannotChangeBoard,
      NotAMember,
      MemberHasNoSafe,
      AlreadyADirector,
      BoardChangeWaiting,
      NotImplemented,
    ]),
  }),
  emits: [{ event: BoardChangeProposed, carries: proposed }],
  budget: {
    ms: 4_000,
    excludes: ["waking a parked world"],
    provisional: true,
    basis:
      "live reads of the company Safe, the Hats protocol and the Signer Gate on the world's chain, then preparing one UserOperation of the founder's Safe",
  },
  examples: [
    {
      payload: { org: "org_northwind1", person: "sam" },
      success: {
        change: {
          id: "bch_seatsam1",
          action: "add",
          person: "sam",
          before: { directors: 2, threshold: 2 },
          after: { directors: 3, threshold: 2 },
          state: "proposed",
        },
        approval: founderApproval("apr_seatsam1"),
      },
    },
  ],
});

/** Who serves it: a world's Core, through the world's door (`WorldRpcs`). */
export const server = "world";

/** What `org.director.add` promises, each promise checked by the journeys. */
export const promises: ClaimsOf = {
  operation: directorAdd,
  claims: [
    claim(
      "The founder seats a member as a Director: one approval, the founder's own, and its signature alone lands it. It is never a Board proposal.",
      w.founded,
      "org.director.add as dana of sam answers the change proposed, 2 Directors at 2 before and 3 at 2 after, and one approval, dana's, at her signer address. The record gains one board_change_proposed carrying only change, org and action, and the company Safe's owners are unchanged until it lands. approval.sign by dana answers Sent for the board change at once, never Collected: through the door's chain RPC its transaction is one UserOperation whose sender is dana's personal Safe, it minted the Director hat to sam's Safe (chain.hat details Director, chain.wears), and chain.safe of Northwind's Safe lists dana's, eli's and sam's Safes at threshold 2. org.member.list then lists sam among the Directors.",
      { thinLine: true },
    ),
    claim(
      "A full Board takes one more seat before the hat is minted.",
      w.founded,
      "Both seats of Northwind's Director hat are worn, by dana's and eli's Safes. In the transaction dana's signature sent, the world's Hats (`contracts.hats`) emits HatMaxSupplyChanged of the Director hat to 3 before the TransferSingle of that hat from the zero address to sam's Safe, and chain.hat reads its supply 3 of 3.",
    ),
    claim(
      "A new Director gets a user on the company's site, as the founding Directors have.",
      w.founded,
      "While the seat waits, report.run as sam of the General Ledger is refused with NoSiteUser, as a member with no hat is. Once it lands, report.run as sam stops refusing NoSiteUser once his user reaches the site, and answers the report; pat, a member with no hat, is still refused with NoSiteUser.",
    ),
    claim(
      "Only the wearer of the Shareholders' top hat, the founder until shares are issued, changes the Board: a member and a Director who did not found it are refused, and nothing is proposed.",
      w.founded,
      "org.director.add of sam as sam, a member, and as eli, a Director, is refused with CannotChangeBoard naming Northwind and the caller. record.export shows no new entry.",
      { refusals: [CannotChangeBoard] },
    ),
    claim(
      "A person who is not a member, a member with no personal Safe, a Director already, and a company nobody founded are each refused before anything is proposed.",
      w.founded,
      "org.director.add as dana of olga is refused with NotAMember naming her; of pat, who has no Safe, with MemberHasNoSafe; of eli with AlreadyADirector; of a company nobody founded with OrgNotFound. record.export shows no new entry for any of them.",
      { refusals: [NotAMember, MemberHasNoSafe, AlreadyADirector, OrgNotFound] },
    ),
    claim(
      "A second change to the Board is refused while one waits for the founder's signature.",
      w.founded,
      "After dana proposes seating sam and before she signs, org.director.add of sam again is refused with BoardChangeWaiting naming the change waiting. record.export shows no new entry.",
      { refusals: [BoardChangeWaiting] },
    ),
  ],
  dropped: [],
};
