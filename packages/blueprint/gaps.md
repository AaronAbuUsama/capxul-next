# Gaps the scenarios found in the claims

The thin line's scenarios (`packages/scenarios`, step 1.5) were written from this blueprint by an agent that never saw
the implementation. These are the claims they could not check in full, grouped by cause, and how each was closed.
Every cause is now closed by a change to the blueprint and the scenarios' client (decisions.md, entries 34 to 46).
The scenarios themselves are unchanged: the scenario author, never a builder, now updates them, by the brief at the
end of this page.

## 1. Nothing reads the chain: closed (decisions 34, 35)

Claims said "through the door's chain RPC", but `Capxul` offered no chain read.

- Closed by `capxul.chain`, the chain reads declared in `src/chain/reads.ts` (`head`, `balance`, `safe`, `hat`,
  `wears`, `companySafeFor`, `transaction`, `logs`) over the world door's read-only chain JSON-RPC (`CHAIN_PATH`),
  decoding the logs of `src/chain/logs.ts`. The addresses they take are in `WorldView.contracts`.
- Supporting changes: `Held.payment.paymentId` (the id `PaymentSent` carries); a company Safe's `company` is the org
  id; a new world mines a block at its start; officer hats are known by their details (`OFFICER_HAT_DETAILS`).
- The claims that read the chain now name the read they use: world.create 2 and 5; org.create 1 and 3;
  org.member.grant 1, 5 and 7; approval.sign 1 to 5; report.run 1; world.clock.warp 1; world.snapshot.save 1;
  world.snapshot.restore 1 and 2.

## 2. The client reaches one world only: closed (decision 36)

- Closed by `CallOptions.at`: a world operation or a chain read with `{ at: view.door }` goes to that world's door,
  signed in with the operator's credential; with `as`, as one of its people.
- world.create 1 and 5, world.snapshot.restore 1 to 3 and record.export 1 now say which calls go `at` which door.

## 3. One operator only: closed (decision 37)

- Closed by `CallOptions.operator: "second"`, and by the operators' names in `nothing`'s facts (`operators`).
- world.create 4, world.snapshot.save 3 and world.snapshot.restore 3 now name the operators they check.

## 4. Starting worlds hand the scenario nothing: closed (decision 38)

- Closed by each starting world's `facts` (claims.md lists what each adds), read with `given(startingWorlds.x)`.
  Every step that answers something a claim needs names its fact: `world` (the call that made the world),
  `founded`, `setupCollected`, `setupSent`, `grant`, `grantCollected`, `grantSent`, `supplier`, `invoice`,
  `invoicePosted`, `payment`, `held`, `paidSent`, `m3`, `draft`, `restored`, and `calls` (every call made in making
  the world, with its trace).
- approval.sign 1 and 4, doc.create 4, doc.submit 1 and 4, record.export 2 and world.show 3 now name the facts they
  read.

## 5. Ambiguities: closed

- **Starting worlds and templates** (decision 39). Decision 27 holds for `fresh` to `paid`; `quota-full`,
  `with-snapshot` and `restored` are made by their steps (`StartingWorld.made`). world.show 2 now starts from
  `nothing` and makes its own world; `fresh` no longer promises its record's length; world.show 3 compares with the
  `world` fact.
- **The site's vocabulary** (decision 40): `src/documents/site.ts` (`Site`), which `support/books.ts` re-exports.
  report.run fills `company` and the period; a doctype's name runs its list, so the Supplier list is the Supplier
  doctype.
- **`office-holder`'s wait** (decision 41) waits on report.run, which makes nothing.
- **Signing and subject ids** (decision 42): `CAST_KEYS` in `src/values.ts`; `Subject` is typed by kind.
- **A payload the schema rejects** (decision 43) fails with `PayloadRejected` and is never sent.
- **world.clock.warp 1** (decision 44) names the Capxul app's daily job, `Site.DAILY_JOB`.
- **world.create 2** (decision 45) starts halfway between the seed's last block and host time: no condition.

## 6. Untestable: closed (decision 46)

`SnapshotIncompatible` is removed; an incompatible restore is a fault.

## The scenario author's brief

What each scenario must now change to check its claim in full. Read claims.md for the claim as it now stands.
Everything below is available to scenarios through `@capxul/blueprint` and `../client.ts`/`../scenario.ts`:
`capxul.chain.<read>(payload, { at?, operator? })`, `CallOptions.at` and `CallOptions.operator`, `given(world)`,
`Site`, `CAST_KEYS`, `OFFICER_HAT_DETAILS`, `WorldView.contracts`.

General, for every scenario that reads facts or the chain:

- Read the starting world's facts with `yield* given(startingWorlds.<world>)` instead of reading them back from the
  record (support/documents.ts's `paymentDocuments`, support/world.ts's `northwind`, where facts now say it).
- A run against empty handlers hands each starting world's example facts and an empty chain (every balance 0, no
  logs); make an operation call before any expectation that could fail on them, so the scenario still fails on
  `NotImplemented`. Then `pnpm --filter @capxul/scenarios record`.
- support/signing.ts should take its mnemonic and account count from `CAST_KEYS`; support/world.ts and
  support/documents.ts may give way to facts.

By scenario:

- **world.create 1**: call `record.export` `at: made.door` and check its one `world_created` entry at seq 1 and what
  it carries; drop the world.show stand-in for the record.
- **world.create 2**: ask for a start halfway between `ClockBeforeSeed.earliest` and host time (no day, no
  condition); read `capxul.chain.head({}, { at: made.door })` and check its timestamp is the start.
- **world.create 4**: check the owner equals `given(startingWorlds.nothing).operators.first`; add the create by
  `{ operator: "second" }` owned by `operators.second`.
- **world.create 5**: for each person call `record.export` `at: made.door` `as` them and expect `NotWorldOwner`;
  read each Safe's `chain.balance` of `made.contracts.usdc` `at: made.door` and expect `10000`.
- **world.create 3, 6**: none.
- **world.show 1**: optionally read the facts' `restored` and `world`; the claim is unchanged.
- **world.show 2**: now from `nothing`: create a world, then `world.show` of it answers parent null; keep the
  WorldNotFound half.
- **world.show 3**: compare world.show with the `world` fact (owner, grade, expiry, door, chain id, contracts,
  cast) instead of the record's `world_created`.
- **world.snapshot.save 1**: also read every personal Safe's and the company Safe's (`founded.safe`) `chain.balance`
  before and after the save.
- **world.snapshot.save 2**: none.
- **world.snapshot.save 3**: add the save by `{ operator: "second" }`, refused `NotWorldOwner` naming
  `operators.first`, and no new entry.
- **world.snapshot.restore 1**: make the doc.create and a held payment's approval.sign in the new world too, with
  `{ at: made.door }`; check each world's record and General Ledger hold only their own; check the company Safe's
  `chain.balance` at each door moves only in its own world.
- **world.snapshot.restore 2**: `record.export` at both doors: the new world's entries up to the position equal the
  first world's, entry for entry; General Ledger and Trial Balance `at` the new door equal the first world's at the
  save; balances and sam's Books hat (`chain.wears`, the hat from `grantSent`'s transaction) read the same at both.
- **world.snapshot.restore 3**: restore `m3` with `{ operator: "second" }`, owned by `operators.second`, and
  `record.export` `at` its door with `{ operator: "second" }` answers; restoring `draft` as the second operator is
  refused `NotWorldOwner` naming `operators.first`.
- **world.snapshot.restore 4, 5**: none.
- **org.create 1**: `chain.logs` of `CompanySafeMinted` from `contracts.companySafeMinter`: one, naming the Safe,
  dana's Safe and the org id; `chain.companySafeFor` with `contracts.companySafeMinter`, `contracts.companiesHouse`,
  `contracts.companyNamespace`, the org id and dana's Safe equals the Safe.
- **org.create 3**: `chain.safe` of the company Safe: owners dana's and eli's Safes, threshold 2; `chain.balance`
  1000 for it and 9000 for dana's Safe; the setup subject is `{ kind: "org_setup", id: org }`.
- **org.create 6**: the long bio must fail with `PayloadRejected` naming `org.create` (replace the
  "no declared refusal" check).
- **org.create 2, 4, 5, 7**: none.
- **org.member.grant 1**: from eli's Sent, `chain.transaction`: a `TransferSingle` from the zero address to sam's
  Safe; `chain.hat` of that id has details `OFFICER_HAT_DETAILS["manage-books"]`; `chain.wears` is true. Keep the
  NoSiteUser wait.
- **org.member.grant 5**: in that transaction's logs from `contracts.hats`, the mint `TransferSingle`, preceded by a
  `HatMaxSupplyChanged` to supply + 1 exactly when `chain.hat` at `block - 1` had supply equal to max supply.
- **org.member.grant 7**: the hat minted for manage-people has details `People` and sam's Safe wears it.
- **org.member.grant 2, 3, 4, 6**: none.
- **doc.create 1**: the Supplier list is now `Site.REPORTS.supplierList`, the Supplier doctype's list; rows carry
  the Supplier's fields (`supplier_name`).
- **doc.create 4**: compare `given(...).payment.hash` with the Held answer's `documentHash` for the starting world's
  own Payment Entry; drop the second Payment Entry.
- **doc.create 2, 3**: none.
- **doc.submit 1**: check `payeeAddress` equals the `supplier` fact's `capxul_wallet_address`
  (`Site.SUPPLIER_FIELDS.paymentAddress`) and that `paymentId` is present.
- **doc.submit 4**: check the refusal's `safe` equals `given(...).founded.safe`.
- **doc.submit 2, 3**: none.
- **approval.sign 1**: sign the starting world's own `held.approval` (drop `hold.ts`'s second Payment Entry);
  `chain.transaction` of the Sent: one `UserOperationEvent` from sam's Safe, one `PaymentSent` with `paymentId` and
  `documentHash` from `held`; `chain.balance` of `contracts.usdc`: Brightside's address (`Site.PAYEE_ADDRESS`, or the
  `supplier` fact) up 125.5 and the company Safe down 125.5.
- **approval.sign 2**: sign `held.approval`; `chain.logs` of `PaymentSent` from `contracts.payments` holds one with
  its `paymentId`.
- **approval.sign 3**: sign `held.approval`; `chain.logs` holds no `PaymentSent` for its `paymentId`.
- **approval.sign 4**: warp past `held.approval.expiresAt`; no `PaymentSent` in `chain.logs`.
- **approval.sign 5**: from eli's Sent, the hat minted to sam's Safe was not worn at `block - 1` (`chain.wears` with
  `block`) and is worn after; drop the NoSiteUser stand-in.
- **report.run 1**: compare the ledger with `chain.balance` of `contracts.usdc` for `founded.safe`, not with 874.50.
- **report.run 2, 3**: none.
- **world.clock.warp 1**: filter the Scheduled Job Log with `{ [Site.FILTERS.scheduledJobLog.job]:
  Site.DAILY_JOB.jobType }` and expect exactly 7 more runs; `chain.head` timestamp at or after the new clock.
- **world.clock.warp 2**: none.
- **record.export 1**: `record.export` `at` the first world's door (`world.show` of the lineage's world gives it):
  entries 1 to the position equal, entry for entry.
- **record.export 2**: for each successful call of the `calls` fact, the record holds exactly
  `operations[call.operation].expected(...)` of its decoded payload and answer under `call.trace`, in order; a
  refused call and a report.run hold none.
- **record.export 3, 4**: none.

## Still open after the scenarios were updated (13 November 2026)

Every claim is now checked as written. These points go back to the blueprint:

1. **world.snapshot.restore 2, "at the snapshot's block".** The `m3` fact names no block, so balances and hats are
   read at the latest block in both worlds. The ledgers are compared with the first world as it is now. That is exact
   only because nothing moves the first world after `m3` is saved. A block number in the snapshot's answer would make
   it exact without that condition.
2. **world.snapshot.restore 1, "in that world's General Ledger only".** Both worlds continue one naming series, so a
   document can have the same name in each. The scenario therefore checks that each world's whole ledger, record head
   and Safe balance are unchanged by the other world's calls.
3. **org.member.grant 5.** Read literally: the Hats logs of the grant's transaction are exactly
   `[HatMaxSupplyChanged?, TransferSingle]`.
4. **Small readings where a claim is silent:**
   - org.create 3 compares the Safe's owners as a set.
   - world.create 6 expects `WorldQuotaReached.owner` to be the first operator.
   - approval.sign 1 takes Brightside's address from the `supplier` fact's `capxul_wallet_address`.
