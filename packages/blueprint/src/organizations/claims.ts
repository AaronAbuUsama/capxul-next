// The acceptance claims of the organizations operations. Rendered into claims.md.
import { claim, dropped, kept, rewritten, type ClaimsOf } from "../claims/claim.ts";
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
  PersonNotFound,
  SetupUnfinished,
} from "../errors.ts";
import { startingWorlds as w } from "../starting-worlds.ts";
import * as Organizations from "./operations.ts";

export const create: ClaimsOf = {
  operation: Organizations.create,
  claims: [
    claim(
      "The Organization's Safe is Companies House's company Safe for this founder.",
      w.fresh,
      "org.create as dana answers a Safe. Through the door's chain RPC, chain.logs holds one CompanySafeMinted emitted by Companies House (`contracts.companiesHouse`, which runs the world's minter, `contracts.companySafeMinter`, by delegatecall, so the log is its own) naming that Safe, dana's personal Safe as founderSafe and the org id as company, and chain.companySafeFor of the world's Companies House owner and namespace (`contracts`), the org id and dana's Safe is the same address.",
      { origin: kept("org.create/c-37a24168b5b82483"), thinLine: true },
    ),
    claim(
      "It answers with the Organization's id and the approvals its founding Directors must sign, before anyone has signed.",
      w.fresh,
      "org.create as dana with eli as a Director and threshold 2 answers Founded with the org id and one approval each for dana and eli, each naming its signer's address and a digest.",
      {
        origin: rewritten(
          "org.create/c-f76d985ce2889eda",
          "It prints and saves the exact ID before authorization, then stops at a truthful deadline.",
          "The operation never waits for a signature, so it has no deadline; the command line's waiting is not part of the contract.",
        ),
      },
    ),
    claim(
      "Once enough founding Directors have signed, the setup completes: the board and the capital are on the chain and the company's site becomes ready.",
      w.fresh,
      "After org.create, approval.sign by dana answers Collected and by eli answers Sent for the org setup, whose subject is the org id. Through the door's chain RPC the company Safe's owners are dana's and eli's Safes with threshold 2 (chain.safe) and it holds 1,000 USDC (chain.balance), and dana's Safe holds 9,000; world.show then lists the company's site as ready.",
    ),
    claim(
      "The same intent resumes the same Organization; a changed intent or another founder refuses.",
      w.fresh,
      "The same org.create twice answers Founded, then Resumed with the same org id and no event. The same handle with another name is refused with FoundingChanged; the same handle founded by eli is refused with HandleTaken. world.show lists one company.",
      { refusals: [FoundingChanged, HandleTaken], origin: kept("org.create/c-f18049cd600668af") },
    ),
    claim(
      "It needs the founder's claimed personal Safe before the first write.",
      w.fresh,
      "org.create as pat is refused with FounderNotReady; world.show lists no company and record.export no new entry.",
      {
        refusals: [FounderNotReady],
        origin: rewritten(
          "org.create/c-313abdcaa41f9df9",
          "It needs the founder's deployed, claimed account before the first write.",
          'What the founder needs is a claimed personal Safe; "account" named an old accounts concept.',
        ),
      },
    ),
    claim(
      "Bio and size are stored trimmed, and an over-long bio is refused.",
      w.fresh,
      "A founding typed with its bio and size padded with spaces, decoded by org.create's payload schema as the command line decodes what a person types, is answered Founded with them trimmed, and the same founding resumes it. The spaces never reach a typed payload, because the schema's typed side is trimmed text: a payload that still holds them, and a bio of 281 characters, are rejected by the payload's schema before they are sent. Each call fails with PayloadRejected naming org.create, no company is made and the record gains no entry.",
      { origin: kept("org.create/c-38c97cf2c6a5056c") },
    ),
    claim(
      "A founding Director or member who is not a person of the world, capital beyond the founder's balance, and a second founding while the first is unfinished are each refused, and nothing is made.",
      w.fresh,
      "org.create naming a Director nobody in the cast is refused with PersonNotFound; with capital of 20,000 USDC, with InsufficientBalance; a second handle by dana while northwind awaits signatures, with SetupUnfinished. record.export shows no entry for any of them.",
      { refusals: [PersonNotFound, InsufficientBalance, SetupUnfinished] },
    ),
  ],
  dropped: [
    dropped(
      "org.create/c-fae49b69ef6deed4",
      "A founder on the beta waitlist is refused until an operator admits them.",
      "Admission is not part of a world: everyone in a world's cast is admitted. The waitlist belongs to real sign-in (roadmap phase 4).",
    ),
    dropped(
      "org.create/c-e74f131ab3816a02",
      "An invalid logo is refused and leaves no Organization and no setup, and its handle stays free.",
      "A logo is a stored file, and no operation of the thin line stores files.",
    ),
  ],
};

export const memberGrant: ClaimsOf = {
  operation: Organizations.memberGrant,
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
