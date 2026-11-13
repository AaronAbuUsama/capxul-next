# Acceptance claims of the thin line

Rendered from `src/<concept>/claims.ts` and the declarations by `pnpm claims`. Do not edit it by hand: a test fails
when this file and its sources differ.

Each claim is proved black-box by a scenario: from its starting world, through the door, reading only what the
operations answer and what the world's door shows of its chain. "Old" names the claim of the old blueprint
(`docs/thin-line/operations.json`, its `evalId`) it keeps, word for word or rewritten.

## What the runner checks on every call

These hold for every call of every scenario, so no claim repeats them:

1. A successful call emits exactly the events its outcome declares, each once, each carrying exactly what the
   declaration computes from the call's payload and answer, and nothing more. A refused call emits none.
2. A refusal is one the operation declares.
3. The call's spans are recorded under the trace id the caller sent, the first named after the operation.
4. The call's time, as the caller saw it and as the server's span measured it, is stored with the run, with the
   time of each step beneath it, next to the operation's budget. A budget is recorded, not enforced: nothing fails
   on speed until a budget is set from measured runs.

## Count

| Operation | Claims | Old, word for word | Old, rewritten | New | Old, not kept |
|---|---|---|---|---|---|
| `world.create` | 6 | 1 | 2 | 3 | 2 |
| `org.create` | 7 | 3 | 2 | 2 | 2 |
| `org.member.grant` | 7 | 3 | 4 | 0 | 1 |
| `doc.create` | 4 | 1 | 0 | 3 | 0 |
| `doc.submit` | 4 | 2 | 0 | 2 | 0 |
| `approval.sign` | 5 | 1 | 3 | 1 | 5 |
| `report.run` | 3 | 1 | 0 | 2 | 0 |
| `world.clock.warp` | 2 | 1 | 0 | 1 | 0 |
| `record.export` | 4 | 1 | 0 | 3 | 0 |
| `world.snapshot.save` | 3 | 1 | 0 | 2 | 0 |
| `world.snapshot.restore` | 5 | 1 | 0 | 4 | 1 |
| `world.show` | 3 | 1 | 0 | 2 | 0 |

## Starting worlds

Declared in `src/starting-worlds.ts`. Each is made through the door from the one before it.

- `nothing`. The platform is deployed. No world has the name the scenario uses. The scenario's operator owns fewer live worlds than the limit, and a second operator exists.
- `quota-full`. Made from `nothing`. The scenario's operator owns as many live private worlds as one owner may have. Steps: `world.create` as operator: creates private worlds until the limit is reached.
- `fresh`. Made from `nothing`. A private world owned by the scenario's operator, its clock frozen, its record one entry long. Its cast: dana, eli, sam and olga, each with a claimed personal Safe holding 10,000 USDC, and pat, who has not finished signing up and has no Safe. No company. Steps: `world.create` as operator: creates a private world with a frozen clock and a lifetime of 60 minutes.
- `founded`. Made from `fresh`. Northwind (handle `northwind`), founded by dana: Directors dana and eli, 2 of 2; members sam and pat with no permission; 1,000 USDC of dana's capital in the company Safe; its site ready, with users for dana and eli. Steps: `org.create` as dana: founds northwind with eli as a Director, threshold 2, members sam and pat, and 1,000 USDC of capital; `approval.sign` as dana: signs her setup approval; `approval.sign` as eli: signs his setup approval, which sends the setup; wait as operator: until world.show lists northwind's site as ready.
- `office-holder`. Made from `founded`. sam holds Manage books: his Safe wears the Books hat and he has a user on Northwind's site. Steps: `org.member.grant` as dana: grants sam manage-books; `approval.sign` as dana: signs the proposal; `approval.sign` as eli: signs the proposal, which executes it; wait as sam: until doc.create stops refusing with NoSiteUser.
- `payment-drafted`. Made from `office-holder`. The supplier Brightside Cleaning Ltd with a payment address; a submitted Purchase Invoice of 125.50 USDC from it; and a draft Payment Entry paying that invoice from the Capxul Safe account. Steps: `doc.create` as sam: creates the Supplier with its payment address; `doc.create` as sam: creates the Purchase Invoice of 125.50 USDC; `doc.submit` as sam: submits the Purchase Invoice, which posts; `doc.create` as sam: creates the Payment Entry from the Capxul Safe account against the invoice.
- `payment-held`. Made from `payment-drafted`. The Payment Entry is submitted and held for sam's signature; nothing is posted for it yet. Steps: `doc.submit` as sam: submits the Payment Entry, which is held.
- `paid`. Made from `payment-held`. sam signed: Brightside was paid 125.50 USDC from the company Safe, the Payment Entry posted and the invoice has nothing outstanding. Steps: `approval.sign` as sam: signs the held payment, which sends it; wait as sam: until report.run's General Ledger shows the Payment Entry.
- `with-snapshot`. Made from `paid`. Two snapshots of the world: `m3`, saved as a template, and `draft`, which is not. Steps: `world.snapshot.save` as operator: saves m3 as a template; `world.snapshot.save` as operator: saves draft.
- `restored`. Made from `with-snapshot`. A second private world, made from `m3` by the same operator, which names the first world, `m3` and its record position as its parent. Steps: `world.snapshot.restore` as operator: restores m3 into a new world with a lifetime of 60 minutes.

## 1. `world.create`

- Served by: the platform group.
- Refusals: `WorldExists`, `GradeNotOffered`, `WorldQuotaReached`, `ClockBeforeSeed`, `NotImplemented`, and `NotSignedIn` from sign-in.
- Emits: `world_created`.
- Budget: 90,000 ms, provisional. Basis: spikes/containers deployed a world with published images in 39 to 43 s and spikes/hosting made a Neon branch in 8 to 10 s; migrations, Core and the cast are not measured yet.

1. A new world runs with its clock and a record that begins with its birth. *(thin line)*
   - Given: `nothing`.
   - Observes: world.create with a frozen clock answers state running, clock frozen, record head 1 and no parent. record.export through the world's door lists exactly one entry, `world_created`, at seq 1.
   - Old: `acc:world.create/c-52e22ec1e2a6c1cc`, kept word for word.
2. A fresh world can begin before host time, though not before its seeded chain's last block, and an existing world's time cannot be reset.
   - Given: `nothing`.
   - Observes: world.create with a frozen clock starting one day after the seeded chain's last block answers that time as its clock, and the chain's head through the door has that timestamp. Creating the same name again is refused with WorldExists naming its owner and expiry, and world.show shows the clock unchanged. A start before the seeded chain's last block is refused with ClockBeforeSeed naming the earliest start.
   - Refusals: `WorldExists`, `ClockBeforeSeed`.
   - Old: `acc:world.create/c-fc7bfdea5dd33f3e`, rewritten. It said: "A fresh world can begin before host time, but an existing world's time cannot be reset." Why: A world's chain is loaded from the seeded chain state, and a chain's time cannot go back past its last block.
3. A real world is never made by this operation: asking for one is refused and nothing is made.
   - Given: `nothing`.
   - Observes: world.create with grade real is refused with GradeNotOffered; world.show of the name is then refused with WorldNotFound.
   - Refusals: `GradeNotOffered`.
   - Old: `acc:world.create/c-4ee06f2f1dd89e20`, rewritten. It said: "Production is never made without the platform owner's approval." Why: Grades replace kinds. A real world is made by the platform's own deploy with Aaron's written go-ahead, never by this operation.
4. Every world has an owner and an expiry: the caller owns the world it creates, and it expires after the lifetime asked for.
   - Given: `nothing`.
   - Observes: world.create with a lifetime of 60 minutes answers the calling operator as owner and an expiry 60 minutes after the call, within a minute; world.show answers the same.
   - Old: none; this claim is new.
5. A world is born with its cast: each person can call through the door and signs with a known test key, and everyone but pat holds a claimed personal Safe with 10,000 USDC.
   - Given: `nothing`.
   - Observes: world.create lists dana, eli, sam, pat and olga, each with a signer address; every one but pat has a Safe, and each Safe's USDC balance read through the door's chain RPC is 10,000.
   - Old: none; this claim is new.
6. An owner with as many live worlds as allowed is refused, and nothing is made.
   - Given: `quota-full`.
   - Observes: world.create is refused with WorldQuotaReached naming the owner, the live count and the limit; world.show of the name is refused with WorldNotFound.
   - Refusals: `WorldQuotaReached`.
   - Old: none; this claim is new.

Old claims not kept:

- `acc:world.create/c-51839d5bf812fa32`: "A `full` world gives each company a site on its own address and a `core` world gives none." Why: There are no profiles. A company gets its site when it is founded (roadmap step 1.4), in every world.
- `acc:world.create/c-43a66f24b447122c`: "A world made from a template starts with the template's companies on their own addresses." Why: A world is made from a template by world.snapshot.restore, whose claims cover it.

## 2. `org.create`

- Served by: the world group.
- Refusals: `FounderNotReady`, `HandleTaken`, `FoundingChanged`, `SetupUnfinished`, `PersonNotFound`, `InsufficientBalance`, `NotImplemented`, and `NotSignedIn` from sign-in.
- Emits: `Founded`: `org_founded`; `Resumed`: none.
- Budget: 8,000 ms, provisional, excluding waking a parked world. Basis: two service-key transactions (the company Safe's mint and its deploy) on the world's own chain, then opening the approvals.

1. The Organization's Safe is Companies House's company Safe for this founder. *(thin line)*
   - Given: `fresh`.
   - Observes: org.create as dana answers a Safe. Through the door's chain RPC, CompanySafeMinted names that Safe with dana's personal Safe as founderSafe, and the minter's companySafeAddressFor(dana's Safe) is the same address.
   - Old: `acc:org.create/c-37a24168b5b82483`, kept word for word.
2. It answers with the Organization's id and the approvals its founding Directors must sign, before anyone has signed.
   - Given: `fresh`.
   - Observes: org.create as dana with eli as a Director and threshold 2 answers Founded with the org id and one approval each for dana and eli, each naming its signer's address and a digest.
   - Old: `acc:org.create/c-f76d985ce2889eda`, rewritten. It said: "It prints and saves the exact ID before authorization, then stops at a truthful deadline." Why: The operation never waits for a signature, so it has no deadline; the command line's waiting is not part of the contract.
3. Once enough founding Directors have signed, the setup completes: the board and the capital are on the chain and the company's site becomes ready.
   - Given: `fresh`.
   - Observes: After org.create, approval.sign by dana answers Collected and by eli answers Sent for the org setup. Through the door's chain RPC the company Safe's owners are dana's and eli's Safes with threshold 2 and it holds 1,000 USDC; world.show then lists the company's site as ready.
   - Old: none; this claim is new.
4. The same intent resumes the same Organization; a changed intent or another founder refuses.
   - Given: `fresh`.
   - Observes: The same org.create twice answers Founded, then Resumed with the same org id and no event. The same handle with another name is refused with FoundingChanged; the same handle founded by eli is refused with HandleTaken. world.show lists one company.
   - Refusals: `FoundingChanged`, `HandleTaken`.
   - Old: `acc:org.create/c-f18049cd600668af`, kept word for word.
5. It needs the founder's claimed personal Safe before the first write.
   - Given: `fresh`.
   - Observes: org.create as pat is refused with FounderNotReady; world.show lists no company and record.export no new entry.
   - Refusals: `FounderNotReady`.
   - Old: `acc:org.create/c-313abdcaa41f9df9`, rewritten. It said: "It needs the founder's deployed, claimed account before the first write." Why: What the founder needs is a claimed personal Safe; "account" named an old accounts concept.
6. Bio and size are stored trimmed, and an over-long bio is refused.
   - Given: `fresh`.
   - Observes: org.create with a bio and a size padded with spaces answers them trimmed. A bio of 281 characters is rejected by the payload's schema and no company is made.
   - Old: `acc:org.create/c-38c97cf2c6a5056c`, kept word for word.
7. A founding Director or member who is not a person of the world, capital beyond the founder's balance, and a second founding while the first is unfinished are each refused, and nothing is made.
   - Given: `fresh`.
   - Observes: org.create naming a Director nobody in the cast is refused with PersonNotFound; with capital of 20,000 USDC, with InsufficientBalance; a second handle by dana while northwind awaits signatures, with SetupUnfinished. record.export shows no entry for any of them.
   - Refusals: `PersonNotFound`, `InsufficientBalance`, `SetupUnfinished`.
   - Old: none; this claim is new.

Old claims not kept:

- `acc:org.create/c-fae49b69ef6deed4`: "A founder on the beta waitlist is refused until an operator admits them." Why: Admission is not part of a world: everyone in a world's cast is admitted. The waitlist belongs to real sign-in (roadmap phase 4).
- `acc:org.create/c-e74f131ab3816a02`: "An invalid logo is refused and leaves no Organization and no setup, and its handle stays free." Why: A logo is a stored file, and no operation of the thin line stores files.

## 3. `org.member.grant`

- Served by: the world group.
- Refusals: `OrgNotFound`, `NotADirector`, `NotAMember`, `AlreadyHeld`, `ChangeWaiting`, `MemberHasNoSafe`, `NotImplemented`, and `NotSignedIn` from sign-in.
- Emits: `officer_change_proposed`, `proposal_opened`.
- Budget: 4,000 ms, provisional, excluding waking a parked world. Basis: live reads of the Safe, Hats and the signer gate on the world's chain, then opening one approval per Director.

1. A grant is a Director proposal, applied once it executes. *(thin line)*
   - Given: `founded`.
   - Observes: org.member.grant as dana of manage-books to sam answers the change proposed and one approval each for dana and eli. approval.sign by dana answers Collected, 1 of 2; by eli, Sent for the officer change. Through the door's chain RPC sam's Safe then wears the Books hat, and doc.create as sam stops refusing with NoSiteUser once his user reaches the site.
   - Old: `acc:org.member.grant/c-6412f20281167621`, kept word for word.
2. A caller who is not a Director, a person who is not a current member, and a grant of what the member holds are each refused.
   - Given: `office-holder`.
   - Observes: As sam it is refused with NotADirector; for olga, with NotAMember; manage-books for sam again, with AlreadyHeld. record.export shows no new entry.
   - Refusals: `NotADirector`, `NotAMember`, `AlreadyHeld`.
   - Old: `acc:org.member.grant/c-ed5a48c2e1b12719`, rewritten. It said: "A caller who is not a Director, an email that is not a current Seat, and a grant of what the Seat holds are each refused." Why: A member is named as a person of the world, not by email, and "Seat" is not a word of this contract.
3. A second change is refused while one waits.
   - Given: `founded`.
   - Observes: After a grant of manage-books to sam that nobody has signed, a grant of issue-invoices to sam is refused with ChangeWaiting naming the waiting change.
   - Refusals: `ChangeWaiting`.
   - Old: `acc:org.member.grant/c-3e81e998390a6602`, kept word for word.
4. It emits one officer_change_proposed, carrying neither the member nor the note.
   - Given: `founded`.
   - Observes: The runner's events check finds exactly one officer_change_proposed with only change, org, permission and proposal: a recorded field more fails it.
   - Old: `acc:org.member.grant/c-b8a4adcbed22e66d`, rewritten. It said: "It reports one `officer_change_transitioned` (`propose`) for the proposing Director, carrying neither the Seat nor the note." Why: Events are named for what happened, not for a state machine's transition.
5. The proposal mints the officer hat to the member's Safe, and takes one more seat first when every seat is worn.
   - Given: `founded`.
   - Observes: Through the door's chain RPC, the executed transaction is Hats.mintHat(hat, sam's Safe), preceded by changeHatMaxSupply(hat, supply + 1) when every seat of the hat is worn.
   - Old: `acc:org.member.grant/c-3254ec4a40c86a97`, rewritten. It said: "The proposal mints the officer hat to the Seat's Safe, and takes one more seat first when every seat is worn." Why: "Seat" is not a word of this contract.
6. A member whose Safe already wears the hat, and a member with no personal Safe, are each refused before anything is proposed.
   - Given: `office-holder`.
   - Observes: manage-books for sam is refused with AlreadyHeld; any permission for pat is refused with MemberHasNoSafe. record.export shows no new entry.
   - Refusals: `AlreadyHeld`, `MemberHasNoSafe`.
   - Old: `acc:org.member.grant/c-7db203df47b9ca84`, rewritten. It said: "A Seat whose Safe already wears the hat, and a Seat with no personal Safe, are each refused before anything is proposed." Why: "Seat" is not a word of this contract.
7. Manage people is the People hat.
   - Given: `founded`.
   - Observes: After a grant of manage-people to sam is signed by dana and eli, sam's Safe wears the deployment's People hat, read through the door's chain RPC.
   - Old: `acc:org.member.grant/c-640d6eb596538a6f`, kept word for word.

Old claims not kept:

- `acc:org.member.grant/c-6fd22fa2a0774ed8`: "With the Director proposals gate off it is refused, and Manage books needs the books gate too." Why: Feature gates are not part of the thin line; they come back with the journey that switches parts on and off.

## 4. `doc.create`

- Served by: the world group.
- Refusals: `OrgNotFound`, `NoSiteUser`, `SiteRefused`, `SiteUnavailable`, `NotImplemented`, and `NotSignedIn` from sign-in.
- Emits: `doc_created`.
- Budget: 1,500 ms, provisional, excluding waking a parked world. Basis: one call to the company's site on the world's bench; the bench is not measured yet.

1. A document is created as a draft and Frappe's validations apply. *(thin line)*
   - Given: `office-holder`.
   - Observes: doc.create as sam of a Supplier named Brightside Cleaning Ltd answers its name and docstatus 0. A Supplier with no name is refused with SiteRefused for validation, and report.run of the Supplier list shows only Brightside.
   - Refusals: `SiteRefused`.
   - Old: `acc:doc.create/c-4a88a94b435451b9`, kept word for word.
2. A caller with no user on the company's site is refused, and nothing is made.
   - Given: `office-holder`.
   - Observes: doc.create as pat is refused with NoSiteUser; record.export shows no new entry.
   - Refusals: `NoSiteUser`.
   - Old: none; this claim is new.
3. A member whose roles do not allow the document is refused by the site, and nothing is made.
   - Given: `office-holder`.
   - Observes: doc.create as sam of an Employee is refused with SiteRefused for permission; record.export shows no new entry.
   - Refusals: `SiteRefused`.
   - Old: none; this claim is new.
4. The answer carries the document's hash, and a payment held for the document names the same hash.
   - Given: `payment-drafted`.
   - Observes: The hash doc.create answered for the Payment Entry equals `payment.documentHash` in doc.submit's Held answer for it.
   - Old: none; this claim is new.

## 5. `doc.submit`

- Served by: the world group.
- Refusals: `OrgNotFound`, `NoSiteUser`, `SiteRefused`, `SiteUnavailable`, `NotADraft`, `InsufficientBalance`, `NotImplemented`, and `NotSignedIn` from sign-in.
- Emits: `Posted`: `doc_submitted`; `Held`: `payment_held`.
- Budget: 3,000 ms, provisional, excluding waking a parked world. Basis: one call to the site; a held payment also reads the index and opens a sponsored approval on the world's chain.

1. A Payment Entry from the Safe is held, not posted, and the signer is named. *(thin line)*
   - Given: `payment-drafted`.
   - Observes: doc.submit as sam of the Payment Entry answers Held with docstatus 0, the amount 125.50 USDC, Brightside's address and an approval whose signer is sam. report.run's General Ledger shows no line for it yet.
   - Old: `acc:doc.submit/c-df3c0c51cdf3899b`, kept word for word.
2. An ordinary document posts to the ledger when submitted.
   - Given: `office-holder`.
   - Observes: doc.submit as sam of a draft Purchase Invoice answers Posted with docstatus 1; report.run's General Ledger shows its lines.
   - Old: `acc:doc.submit/c-74a45893884b5bef`, kept word for word.
3. A document that is not a draft is refused, and nothing changes.
   - Given: `payment-held`.
   - Observes: doc.submit of the posted Purchase Invoice is refused with NotADraft naming docstatus 1; record.export shows no new entry.
   - Refusals: `NotADraft`.
   - Old: none; this claim is new.
4. A payment from the Safe of more than the Safe holds is refused before anything is held.
   - Given: `office-holder`.
   - Observes: doc.submit of a Payment Entry of 5,000 USDC from the Capxul Safe account is refused with InsufficientBalance naming the Safe, its balance and the amount; no approval is opened and record.export shows no new entry.
   - Refusals: `InsufficientBalance`.
   - Old: none; this claim is new.

## 6. `approval.sign`

- Served by: the world group.
- Refusals: `ApprovalNotFound`, `NotYourApproval`, `SignatureInvalid`, `ApprovalExpired`, `ApprovalClosed`, `InsufficientBalance`, `TransactionReverted`, `NotImplemented`, and `NotSignedIn` from sign-in.
- Emits: `Collected`: `approval_signed`; `Sent`: `approval_signed`, `approval_landed`; `AlreadySent`: none.
- Budget: 4,000 ms, provisional, excluding waking a parked world and chain confirmation on a public chain. Basis: a sponsored UserOperation or Safe transaction on the world's own chain, which mines at once; it answers when the transaction is in a block.

1. A signed held payment is sent once, from the signer's Safe, and its Payment Entry posts once. *(thin line)*
   - Given: `payment-held`.
   - Observes: approval.sign as sam with his key's signature of the digest answers Sent for the payment with one transaction. Through the door's chain RPC that transaction holds one UserOperationEvent from sam's Safe and one PaymentSent carrying the payment's id; Brightside's address gained 125.50 USDC and the company Safe lost 125.50. report.run's General Ledger then shows the Payment Entry once and the invoice has nothing outstanding.
   - Old: `acc:payment.send/c-c9400dfaeba081e7`, rewritten. It said: "A signed personal payment is sent once and records its one Payment." Why: The thin line signs a payment held by doc.submit from the company Safe; it does not prepare a personal payment.
2. A replay of the same signature answers with the same hash and sends nothing more.
   - Given: `payment-held`.
   - Observes: approval.sign with the same signature twice answers Sent, then AlreadySent with the same transaction and no event. Through the door's chain RPC there is one PaymentSent for the payment.
   - Old: `acc:payment.send/c-59edd1848ac75c56`, kept word for word.
3. A signature that does not recover the signer, an unknown approval and another person's approval are each refused, and nothing is sent.
   - Given: `payment-held`.
   - Observes: approval.sign as sam with olga's key's signature is refused with SignatureInvalid naming both addresses; of an id nobody issued, with ApprovalNotFound; as olga of sam's approval, with NotYourApproval. No PaymentSent appears through the door's chain RPC and record.export shows no new entry.
   - Refusals: `SignatureInvalid`, `ApprovalNotFound`, `NotYourApproval`.
   - Old: `acc:payment.send/c-59a1c78521a27aca`, rewritten. It said: "A signature that does not recover the account's signer, an unknown execution and another person's execution are each refused and nothing is sent." Why: What is signed is an approval, not an execution.
4. An expired approval is refused, naming when it expired, and nothing is sent.
   - Given: `payment-held`.
   - Observes: The operator warps the clock past the approval's expiry; approval.sign as sam is then refused with ApprovalExpired naming the expiry, and no PaymentSent appears.
   - Refusals: `ApprovalExpired`.
   - Old: `acc:payment.send/c-37ce3ad182b6ecb0`, rewritten. It said: "An expired approval is refused and names the wait command." Why: Which command to run next is the command line's to say; the refusal carries the expiry it needs to say it.
5. A signature short of the threshold is kept, and nothing is sent until the last one needed.
   - Given: `founded`.
   - Observes: After org.member.grant, approval.sign by dana answers Collected with 1 of 2 and the hat is not worn; approval.sign by eli answers Sent.
   - Old: none; this claim is new.

Old claims not kept:

- `acc:payment.send/c-f0567d73a498e614`: "An Organization payment uses the one spending allowance you hold for the asset, and with several asks which and takes `--from`." Why: It is about preparing a new payment with payment.send, which is not in the thin line; it stays with payment.send's journey.
- `acc:payment.send/c-fd8fc63a3750fb85`: "A mistyped address, and a recipient that is nothing, are refused naming it." Why: It is about preparing a new payment with payment.send, which is not in the thin line; it stays with payment.send's journey.
- `acc:payment.send/c-dd1de9fc08186cfb`: "A payment from a spending allowance is one `Budgets.spend` from the wearer's Safe; before anyone signs, the route must name that allowance's own active budget, and a route to another budget, a pending allowance or an unreadable list is closed unsent." Why: It is about preparing a new payment with payment.send, which is not in the thin line; it stays with payment.send's journey.
- `acc:payment.send/c-88977816e3ab1aa9`: "A dated Director payment is one exact `Budgets.schedule` of the asked amount to the asked address on a v4 Budgets; another amount, recipient or contract is refused before anyone approves." Why: It is about preparing a new payment with payment.send, which is not in the thin line; it stays with payment.send's journey.
- `acc:payment.send/c-e0782c0ab0380104`: "Once its Board proposal executes, each item reads `scheduled` with the scheduled id of its own `Budgets.schedule`, never one on another budget, and it still does when a chain read fails once on the way." Why: It is about preparing a new payment with payment.send, which is not in the thin line; it stays with payment.send's journey.

## 7. `report.run`

- Served by: the world group.
- Refusals: `OrgNotFound`, `NoSiteUser`, `SiteRefused`, `SiteUnavailable`, `NotImplemented`, and `NotSignedIn` from sign-in.
- Emits: none.
- Budget: 8,000 ms, provisional, excluding waking a parked world. Basis: no report has been timed; a report reads many rows on the site. The first green run replaces this.

1. A report runs as the caller and the books agree with the chain. *(thin line)*
   - Given: `paid`.
   - Observes: report.run as sam of the General Ledger filtered to the Capxul Safe account answers lines whose balance equals the company Safe's USDC balance read through the door's chain RPC at the world's now; the Trial Balance agrees, and the paid invoice has nothing outstanding.
   - Old: `acc:report.run/c-6c39c42c744b8c91`, kept word for word.
2. A report the caller's roles do not open, and a report that does not exist, are each refused by the site.
   - Given: `paid`.
   - Observes: report.run as sam of a payroll report is refused with SiteRefused for permission; of `Ledger of Everything`, with SiteRefused for not_found.
   - Refusals: `SiteRefused`.
   - Old: none; this claim is new.
3. A caller with no user on the company's site is refused.
   - Given: `paid`.
   - Observes: report.run as pat is refused with NoSiteUser.
   - Refusals: `NoSiteUser`.
   - Old: none; this claim is new.

## 8. `world.clock.warp`

- Served by: the world group.
- Refusals: `NotWorldOwner`, `ClockBackwards`, `NotImplemented`, and `NotSignedIn` from sign-in.
- Emits: `clock_warped`.
- Budget: 30,000 ms, provisional, excluding waking a parked world. Basis: a guess for a warp of up to a month that stops at every due instant; spikes/bench-clocks proved the sites follow but timed no warp.

1. A warp moves the chain and every site together and runs what fell due. *(thin line)*
   - Given: `founded`.
   - Observes: world.clock.warp by 7 days answers the clock a week on and one site. The chain's head through the door has a timestamp at or after it, and report.run of the Scheduled Job Log shows the site's daily job ran once for each day. A warp to an earlier time is refused with ClockBackwards and the clock does not move.
   - Refusals: `ClockBackwards`.
   - Old: `acc:world.clock.warp/c-2bceeaa41942995d`, kept word for word.
2. Only the world's owner may move the clock; a person of the world is refused and the clock does not move.
   - Given: `founded`.
   - Observes: world.clock.warp as dana is refused with NotWorldOwner; world.show shows the clock unchanged.
   - Refusals: `NotWorldOwner`.
   - Old: none; this claim is new.

## 9. `record.export`

- Served by: the world group.
- Refusals: `NotWorldOwner`, `ExportNotAllowed`, `NotImplemented`, and `NotSignedIn` from sign-in.
- Emits: none.
- Budget: 1,500 ms, provisional, excluding waking a parked world. Basis: one indexed read of the world's database; the pipeline spike's record.export read every entry within its 500 ms budget.

1. An export carries the lineage and every entry once. *(thin line)*
   - Given: `restored`.
   - Observes: record.export of the restored world answers a lineage naming the first world, `m3` and its record position, and entries 1 to the head, each once, in order: the first world's entries up to that position, then `world_created`.
   - Old: `acc:record.export/c-bd1acd26102d2d92`, kept word for word.
2. The record is the world's events: every event a successful call emitted is one entry, in order, carrying exactly what the event carried, and a refused call or a read adds none.
   - Given: `paid`.
   - Observes: For every call the scenario made while reaching `paid`, record.export holds that call's declared events under its trace id with the same carried values, in the order the calls were made; a refused call and a report.run hold none.
   - Old: none; this claim is new.
3. Only the world's owner may export the record.
   - Given: `fresh`.
   - Observes: record.export as dana is refused with NotWorldOwner.
   - Refusals: `NotWorldOwner`.
   - Old: none; this claim is new.
4. A range answers only the entries from and to the positions asked, and a range past the head answers none.
   - Given: `paid`.
   - Observes: record.export from 2 to 3 answers entries 2 and 3; from the head plus one answers no entries and the same head.
   - Old: none; this claim is new.

## 10. `world.snapshot.save`

- Served by: the platform group.
- Refusals: `WorldNotFound`, `NotWorldOwner`, `SnapshotExists`, `NotImplemented`, and `NotSignedIn` from sign-in.
- Emits: `snapshot_saved`.
- Budget: 30,000 ms, provisional, excluding waking a parked world. Basis: a Neon branch takes 8 to 10 s (spikes/hosting) and saving the chain 0.8 to 2.1 s (spikes/containers); a site's backup is not measured.

1. A snapshot saves everything that makes the world and leaves it untouched. *(thin line)*
   - Given: `paid`.
   - Observes: world.snapshot.save answers the record position it holds, the clock and one company. Afterwards record.export lists one new entry, `snapshot_saved`, and nothing else changed: world.show, the General Ledger and the Safes' balances read the same as before. world.snapshot.restore of it is covered by that operation's claims.
   - Old: `acc:world.snapshot.save/c-69e4dbcdf13e3750`, kept word for word.
2. A name already saved is refused unless replacing is asked for, and the snapshot is unchanged.
   - Given: `with-snapshot`.
   - Observes: world.snapshot.save of `m3` without replace is refused with SnapshotExists and the record gains no entry; with replace it answers a new record position.
   - Refusals: `SnapshotExists`.
   - Old: none; this claim is new.
3. Only the world's owner may save a snapshot, and only of a world that exists.
   - Given: `fresh`.
   - Observes: world.snapshot.save by the second operator is refused with NotWorldOwner naming the owner; of a name with no world, with WorldNotFound.
   - Refusals: `NotWorldOwner`, `WorldNotFound`.
   - Old: none; this claim is new.

## 11. `world.snapshot.restore`

- Served by: the platform group.
- Refusals: `WorldNotFound`, `SnapshotNotFound`, `NotWorldOwner`, `WorldExists`, `ExpiryBeyondSource`, `WorldQuotaReached`, `SnapshotIncompatible`, `NotImplemented`, and `NotSignedIn` from sign-in.
- Emits: `world_created`.
- Budget: 120,000 ms, provisional. Basis: a branch fork took 10 s (spikes/hosting) and a deploy 39 to 43 s (spikes/containers); restoring sites onto a bench is not measured.

1. A restore into a separate world leaves the first world untouched and the two never see each other. *(thin line)*
   - Given: `with-snapshot`.
   - Observes: world.snapshot.restore of `m3` as a new world answers a different door and the parent. A doc.create and an approval.sign of a payment in each world appear in that world's record.export and General Ledger only, and each Safe's balance through each door moves only in its own world.
   - Old: `acc:world.snapshot.restore/c-1dd79fdbcb1c0fd7`, kept word for word.
2. The new world holds what the snapshot saved: its record up to the snapshot, its clock, its people, companies, documents, balances and hats.
   - Given: `with-snapshot`.
   - Observes: In the new world record.export lists the first world's entries up to the snapshot's position, then one `world_created` naming the parent; the clock is the snapshot's; the General Ledger, Trial Balance, Safe balances and hats read the same as in the first world at the save.
   - Old: none; this claim is new.
3. Anyone on the platform may restore a template snapshot; only the owner may restore any other.
   - Given: `with-snapshot`.
   - Observes: The second operator restores `m3` and owns the new world. Restoring `draft` as the second operator is refused with NotWorldOwner.
   - Refusals: `NotWorldOwner`.
   - Old: none; this claim is new.
4. A world made from a snapshot cannot outlive the world it came from.
   - Given: `with-snapshot`.
   - Observes: A restore whose lifetime ends after the first world's expiry is refused with ExpiryBeyondSource naming the latest expiry allowed, and nothing is made.
   - Refusals: `ExpiryBeyondSource`.
   - Old: none; this claim is new.
5. A snapshot that does not exist, or a new world's name that is taken, is refused and nothing is made.
   - Given: `with-snapshot`.
   - Observes: A restore of `m9` is refused with SnapshotNotFound; a restore as the first world's own name is refused with WorldExists.
   - Refusals: `SnapshotNotFound`, `WorldExists`.
   - Old: none; this claim is new.

Old claims not kept:

- `acc:world.snapshot.restore/c-369b1db183b9807f`: "An in-place restore returns the world to the snapshot and records it." Why: A world is never rewound in place. Going back is a restore into a new world, which costs a branch fork, keeps the record append-only and needs no epochs.

## 12. `world.show`

- Served by: the platform group.
- Refusals: `WorldNotFound`, `NotImplemented`, and `NotSignedIn` from sign-in.
- Emits: none.
- Budget: 2,000 ms, provisional. Basis: reads the registry and the world's database; spikes/hosting measured 350 to 450 ms for a query that wakes a Neon branch.

1. A world restored into another names its parent. *(thin line)*
   - Given: `restored`.
   - Observes: world.show of the restored world answers parent with the first world, `m3` and the record position `m3` holds.
   - Old: `acc:world.show/c-6aa449b0c9f7abaf`, kept word for word.
2. A world made from nothing names no parent, and a name with no world is refused.
   - Given: `fresh`.
   - Observes: world.show answers parent null. world.show of a name no world has is refused with WorldNotFound.
   - Refusals: `WorldNotFound`.
   - Old: none; this claim is new.
3. It shows a world's owner, grade, expiry, clock, record head, cast and companies, each company with its site's state.
   - Given: `founded`.
   - Observes: world.show answers the values world.create answered, a record head that matches record.export's, and northwind with its site ready at its own address.
   - Old: none; this claim is new.
