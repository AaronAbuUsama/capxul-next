# Acceptance claims of the domain `organizations`

Rendered from `claims.ts` here and the declarations by `pnpm claims`. Do not edit it by hand: a test fails when
this file and its sources differ. What the runner checks on every call, and the starting worlds a claim is in,
are in [claims.md](../../claims.md).

## Count

| Operation | Claims | Old, word for word | Old, rewritten | New | Old, not kept |
|---|---|---|---|---|---|
| `org.create` | 7 | 3 | 2 | 2 | 2 |
| `org.member.grant` | 7 | 3 | 4 | 0 | 1 |

## 1. `org.create`

- Served by: the world group.
- Refusals: `FounderNotReady`, `HandleTaken`, `FoundingChanged`, `SetupUnfinished`, `PersonNotFound`, `InsufficientBalance`, `NotImplemented`, and `NotSignedIn` from sign-in.
- Emits: `Founded`: `org_founded`; `Resumed`: none.
- Budget: 8,000 ms, provisional, excluding waking a parked world. Basis: two service-key transactions (the company Safe's mint and its deploy) on the world's own chain, then opening the approvals.

1. The Organization's Safe is Companies House's company Safe for this founder. *(thin line)*
   - In: `fresh`.
   - Observes: org.create as dana answers a Safe. Through the door's chain RPC, chain.logs holds one CompanySafeMinted emitted by Companies House (`contracts.companiesHouse`, which runs the world's minter, `contracts.companySafeMinter`, by delegatecall, so the log is its own) naming that Safe, dana's personal Safe as founderSafe and the org id as company, and chain.companySafeFor of the world's Companies House owner and namespace (`contracts`), the org id and dana's Safe is the same address.
   - Old: `acc:org.create/c-37a24168b5b82483`, kept word for word.
2. It answers with the Organization's id and the approvals its founding Directors must sign, before anyone has signed.
   - In: `fresh`.
   - Observes: org.create as dana with eli as a Director and threshold 2 answers Founded with the org id and one approval each for dana and eli, each naming its signer's address and a digest.
   - Old: `acc:org.create/c-f76d985ce2889eda`, rewritten. It said: "It prints and saves the exact ID before authorization, then stops at a truthful deadline." Why: The operation never waits for a signature, so it has no deadline; the command line's waiting is not part of the contract.
3. Once enough founding Directors have signed, the setup completes: the board and the capital are on the chain and the company's site becomes ready.
   - In: `fresh`.
   - Observes: After org.create, approval.sign by dana answers Collected and by eli answers Sent for the org setup, whose subject is the org id. Through the door's chain RPC the company Safe's owners are dana's and eli's Safes with threshold 2 (chain.safe) and it holds 1,000 USDC (chain.balance), and dana's Safe holds 9,000; world.show then lists the company's site as ready.
   - Old: none; this claim is new.
4. The same intent resumes the same Organization; a changed intent or another founder refuses.
   - In: `fresh`.
   - Observes: The same org.create twice answers Founded, then Resumed with the same org id and no event. The same handle with another name is refused with FoundingChanged; the same handle founded by eli is refused with HandleTaken. world.show lists one company.
   - Refusals: `FoundingChanged`, `HandleTaken`.
   - Old: `acc:org.create/c-f18049cd600668af`, kept word for word.
5. It needs the founder's claimed personal Safe before the first write.
   - In: `fresh`.
   - Observes: org.create as pat is refused with FounderNotReady; world.show lists no company and record.export no new entry.
   - Refusals: `FounderNotReady`.
   - Old: `acc:org.create/c-313abdcaa41f9df9`, rewritten. It said: "It needs the founder's deployed, claimed account before the first write." Why: What the founder needs is a claimed personal Safe; "account" named an old accounts concept.
6. Bio and size are stored trimmed, and an over-long bio is refused.
   - In: `fresh`.
   - Observes: A founding typed with its bio and size padded with spaces, decoded by org.create's payload schema as the command line decodes what a person types, is answered Founded with them trimmed, and the same founding resumes it. The spaces never reach a typed payload, because the schema's typed side is trimmed text: a payload that still holds them, and a bio of 281 characters, are rejected by the payload's schema before they are sent. Each call fails with PayloadRejected naming org.create, no company is made and the record gains no entry.
   - Old: `acc:org.create/c-38c97cf2c6a5056c`, kept word for word.
7. A founding Director or member who is not a person of the world, capital beyond the founder's balance, and a second founding while the first is unfinished are each refused, and nothing is made.
   - In: `fresh`.
   - Observes: org.create naming a Director nobody in the cast is refused with PersonNotFound; with capital of 20,000 USDC, with InsufficientBalance; a second handle by dana while northwind awaits signatures, with SetupUnfinished. record.export shows no entry for any of them.
   - Refusals: `PersonNotFound`, `InsufficientBalance`, `SetupUnfinished`.
   - Old: none; this claim is new.

Old claims not kept:

- `acc:org.create/c-fae49b69ef6deed4`: "A founder on the beta waitlist is refused until an operator admits them." Why: Admission is not part of a world: everyone in a world's cast is admitted. The waitlist belongs to real sign-in (roadmap phase 4).
- `acc:org.create/c-e74f131ab3816a02`: "An invalid logo is refused and leaves no Organization and no setup, and its handle stays free." Why: A logo is a stored file, and no operation of the thin line stores files.

## 2. `org.member.grant`

- Served by: the world group.
- Refusals: `OrgNotFound`, `NotADirector`, `NotAMember`, `AlreadyHeld`, `ChangeWaiting`, `MemberHasNoSafe`, `NotImplemented`, and `NotSignedIn` from sign-in.
- Emits: `officer_change_proposed`, `proposal_opened`.
- Budget: 4,000 ms, provisional, excluding waking a parked world. Basis: live reads of the Safe, Hats and the signer gate on the world's chain, then opening one approval per Director.

1. A grant is a Director proposal, applied once it executes. *(thin line)*
   - In: `founded`.
   - Observes: org.member.grant as dana of manage-books to sam answers the change proposed and one approval each for dana and eli. approval.sign by dana answers Collected, 1 of 2; by eli, Sent for the officer change. Through the door's chain RPC (chain.transaction of what eli's signature sent) a hat is minted to sam's Safe, chain.hat gives its details as Books, and chain.wears says sam's Safe wears it; doc.create as sam stops refusing with NoSiteUser once his user reaches the site.
   - Old: `acc:org.member.grant/c-6412f20281167621`, kept word for word.
2. A caller who is not a Director, a person who is not a current member, and a grant of what the member holds are each refused.
   - In: `office-holder`.
   - Observes: As sam it is refused with NotADirector; for olga, with NotAMember; manage-books for sam again, with AlreadyHeld. record.export shows no new entry.
   - Refusals: `NotADirector`, `NotAMember`, `AlreadyHeld`.
   - Old: `acc:org.member.grant/c-ed5a48c2e1b12719`, rewritten. It said: "A caller who is not a Director, an email that is not a current Seat, and a grant of what the Seat holds are each refused." Why: A member is named as a person of the world, not by email, and "Seat" is not a word of this contract.
3. A second change is refused while one waits.
   - In: `founded`.
   - Observes: After a grant of manage-books to sam that nobody has signed, a grant of issue-invoices to sam is refused with ChangeWaiting naming the waiting change.
   - Refusals: `ChangeWaiting`.
   - Old: `acc:org.member.grant/c-3e81e998390a6602`, kept word for word.
4. It emits one officer_change_proposed, carrying neither the member nor the note.
   - In: `founded`.
   - Observes: The runner's events check finds exactly one officer_change_proposed with only change, org, permission and proposal: a recorded field more fails it.
   - Old: `acc:org.member.grant/c-b8a4adcbed22e66d`, rewritten. It said: "It reports one `officer_change_transitioned` (`propose`) for the proposing Director, carrying neither the Seat nor the note." Why: Events are named for what happened, not for a state machine's transition.
5. The proposal mints the officer hat to the member's Safe, and takes one more seat first when every seat is worn.
   - In: `founded`.
   - Observes: Through the door's chain RPC, the logs of the executed transaction (chain.transaction) from the world's Hats (`contracts.hats`) are a TransferSingle of the hat from the zero address to sam's Safe, which is what Hats.mintHat emits, preceded by a HatMaxSupplyChanged of the hat to its supply + 1 exactly when every seat of the hat was worn at the block before (chain.hat at that block).
   - Old: `acc:org.member.grant/c-3254ec4a40c86a97`, rewritten. It said: "The proposal mints the officer hat to the Seat's Safe, and takes one more seat first when every seat is worn." Why: "Seat" is not a word of this contract.
6. A member whose Safe already wears the hat, and a member with no personal Safe, are each refused before anything is proposed.
   - In: `office-holder`.
   - Observes: manage-books for sam is refused with AlreadyHeld; any permission for pat is refused with MemberHasNoSafe. record.export shows no new entry.
   - Refusals: `AlreadyHeld`, `MemberHasNoSafe`.
   - Old: `acc:org.member.grant/c-7db203df47b9ca84`, rewritten. It said: "A Seat whose Safe already wears the hat, and a Seat with no personal Safe, are each refused before anything is proposed." Why: "Seat" is not a word of this contract.
7. Manage people is the People hat.
   - In: `founded`.
   - Observes: After a grant of manage-people to sam is signed by dana and eli, sam's Safe wears (chain.wears) the hat the transaction minted to it, and chain.hat gives that hat's details as People (OFFICER_HAT_DETAILS).
   - Old: `acc:org.member.grant/c-640d6eb596538a6f`, kept word for word.

Old claims not kept:

- `acc:org.member.grant/c-6fd22fa2a0774ed8`: "With the Director proposals gate off it is refused, and Manage books needs the books gate too." Why: Feature gates are not part of the thin line; they come back with the journey that switches parts on and off.
