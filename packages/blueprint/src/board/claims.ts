// The acceptance claims of the board operations. Rendered into claims.md.
import { claim, type ClaimsOf } from "../claims/claim.ts";
import {
  AlreadyADirector,
  BoardChangeWaiting,
  CannotChangeBoard,
  MemberHasNoSafe,
  NotAMember,
  OrgNotFound,
  ThresholdTooHigh,
  ThresholdUnchanged,
} from "../errors.ts";
import { startingWorlds as w } from "../starting-worlds.ts";
import * as Board from "./operations.ts";

export const directorList: ClaimsOf = {
  operation: Board.directorList,
  claims: [
    claim(
      "A company's Board as the chain holds it: its Directors, the founder first, each with the Safe that signs, and how many must sign.",
      w.founded,
      "org.director.list as dana of Northwind answers dana and eli, each with the Safe of their cast entry, at threshold 2. Through the door's chain RPC those Safes are the company Safe's owners and 2 its threshold (chain.safe), and each wears the Director hat it names (chain.wears). Once sam is seated it answers dana, eli and sam at 2, as sam sees it too. It reads only: the record gains no entry.",
      { thinLine: true },
    ),
    claim(
      "Only the company's own people, and the world's owner, see it.",
      w.founded,
      "org.director.list as the world's owner answers what it answers dana. As olga, who belongs to no company, it is refused with NotAMember naming Northwind and olga; of a company nobody founded, with OrgNotFound. record.export shows no new entry.",
      { refusals: [NotAMember, OrgNotFound] },
    ),
  ],
  dropped: [],
};

export const directorAdd: ClaimsOf = {
  operation: Board.directorAdd,
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

export const thresholdSet: ClaimsOf = {
  operation: Board.thresholdSet,
  claims: [
    claim(
      "The founder sets how many Directors must sign: one approval, the founder's own, and its signature alone lands it; the company Safe then needs that many.",
      w.founded,
      "With sam seated, org.threshold.set as dana to 3 answers the change proposed, 3 Directors at 2 before and at 3 after, and one approval, dana's. The record gains one board_change_proposed, and chain.safe still reads threshold 2. approval.sign by dana answers Sent at once: its transaction is one UserOperation of dana's Safe, chain.safe reads threshold 3 with the same three owners, and org.director.list answers 3.",
      { thinLine: true },
    ),
    claim(
      "Every proposal of the Board then needs the new threshold, and the new Director signs it.",
      w.founded,
      "After the threshold is 3, org.member.grant as dana of manage-books to sam answers one approval each for dana, eli and sam and a proposal of threshold 3. approval.sign by dana answers Collected, 1 of 3, and by eli Collected, 2 of 3, where 2 of 2 would have sent it; sam's answers Sent, and his Safe wears the Books hat (chain.wears).",
    ),
    claim(
      "Only the founder sets it: a Director who did not found the company is refused, and nothing is proposed.",
      w.founded,
      "org.threshold.set as sam, a Director once seated, is refused with CannotChangeBoard naming Northwind and sam. record.export shows no new entry.",
      { refusals: [CannotChangeBoard] },
    ),
    claim(
      "A threshold of none, more than the Directors, or the one the Board has, is refused, and nothing is proposed.",
      w.founded,
      "With 3 Directors at 2, a threshold of 0 is rejected by the payload's schema before it is sent (PayloadRejected naming org.threshold.set); 4 is refused with ThresholdTooHigh naming 4 and 3 Directors; 2 with ThresholdUnchanged; a company nobody founded with OrgNotFound. record.export shows no new entry for any of them.",
      { refusals: [ThresholdTooHigh, ThresholdUnchanged, OrgNotFound] },
    ),
    claim(
      "A second change to the Board is refused while one waits.",
      w.founded,
      "While the change to 3 waits for dana's signature, org.threshold.set as dana to 1 is refused with BoardChangeWaiting naming it. record.export shows no new entry.",
      { refusals: [BoardChangeWaiting] },
    ),
  ],
  dropped: [],
};
