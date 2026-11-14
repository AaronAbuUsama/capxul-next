# Gaps the scenario author found in the claims

The thin line's claims are checked by journeys (`packages/scenarios`; docs/roadmap.md, "Scenarios are journeys", 14
November 2026), written from this blueprint by the scenario author, an agent other than the builders: each operation's
checks run on every call of it in every journey, and `src/coverage.ts` there names the checks and the steps that hold
each claim. Before that, each claim had a scenario of its own (step 1.5). This page lists the claims the scenario
author could not check in full, grouped by cause, and how each was closed. Causes 1 to 6 were found by the per-claim
scenarios on 13 November 2026 and closed by a change to the blueprint and the client (decisions.md, entries 34 to
46); the journeys check every claim as those changes left it. Cause 7 was found by the first run of the journeys in
one world. The points still open at the end are the blueprint's to settle.

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

## 4. Starting worlds handed a scenario nothing: closed (decision 38)

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
- **The site's vocabulary** (decision 40): `src/documents/site.ts` (`Site`), which the journeys' `books.ts` uses.
  report.run fills `company` and the period; a doctype's name runs its list, so the Supplier list is the Supplier
  doctype.
- **`office-holder`'s wait** (decision 41) waits on report.run, which makes nothing.
- **Signing and subject ids** (decision 42): `CAST_KEYS` in `src/values.ts`; `Subject` is typed by kind.
- **A payload the schema rejects** (decision 43) fails with `PayloadRejected` and is never sent.
- **world.clock.warp 1** (decision 44) names the Capxul app's daily job, `Site.DAILY_JOB`.
- **world.create 2** (decision 45) starts halfway between the seed's last block and host time: no condition.

## 6. Untestable: closed (decision 46)

`SnapshotIncompatible` is removed; an incompatible restore is a fault.

## 7. A padded bio cannot be typed: closed (org.create 6, 14 November 2026)

The first run of the journeys in one world (`packages/runner/records/run-39c2b0`, a rehearsal) failed "found Northwind
and give sam the books" at org.create: dana's founding, with its bio and size padded with spaces, was refused
`PayloadRejected` by her own client and never sent.

- Why. `Profile.bio` and `size` are `Schema.Trim`, whose typed side is trimmed text. The SDK checks a payload by
  encoding it from that side (decision 43), as Effect's Rpc client does when it sends, so a typed payload with the
  spaces in it is not a payload of org.create: no Effect client can send it, and no handler is ever asked.
- Where the trimming is. Text with spaces exists only in a payload's encoded form, and the schema trims it as it
  decodes: in the command line, which decodes what a person types with the operation's payload schema before it calls
  (`packages/cli`, `src/input.ts`), and in the server's Rpc, which decodes what arrives on the wire with the same
  schema. Either way the handler is handed trimmed text, and what it must do is store and answer exactly that.
- Considered: a call at the door's wire level that sends the spaces itself. Not taken: no caller of the product sends
  that (the SDK and the command line both decode first); the journeys hold no door credential, only the runner's
  client does, so it would need new runner plumbing; and it would judge Effect's Rpc server decoding with this
  schema, which no builder writes.
- Closed by org.create 6's "Observes", the claim itself unchanged: the founding is typed with the spaces, decoded as
  the command line decodes it, answered `Founded` with them trimmed and resumed by the same founding; a payload that
  still holds the spaces is rejected `PayloadRejected` like the over-long bio. "found Northwind" checks both, in its
  steps 2 and 1.

## 8. Which calls a restored world's record holds: closed (record.export 2, 14 November 2026)

record.export 2 said the record holds the events of every call made in making the starting world. A world restored
from a snapshot holds only those its snapshot copied. The claim now says what record.export's checks hold: the calls
made in the world exported left exactly their events; a call made in the world whose snapshot it was restored from
left exactly its events or none; the journey's own calls at its door left theirs, in order.

## The brief, carried out

The brief this page held for updating each per-claim scenario was carried out in those scenarios on 13 November 2026,
and then the journeys replaced them; it is in this file's history. The journeys check each claim as claims.md now
states it.

## Still open (14 November 2026)

Every claim is checked as written. These points go back to the blueprint:

1. **world.snapshot.restore 2, "at the snapshot's block".** world.snapshot.save's answer for `m3` names no block, so
   "pay Brightside and branch the books" reads balances and hats at the latest block in both worlds and compares the
   branch's books with the first world as it is when the branch is made. That is exact only because nothing moves the
   first world between the save and that comparison. A block number in the snapshot's answer would make it exact
   without that condition.
2. **world.snapshot.restore 1, "in that world's General Ledger only".** Both worlds continue one naming series, so a
   document can have the same name in each. The journey therefore checks that each world's books, record head and
   Safe balances are unchanged by the other world's calls.
3. **org.member.grant 5.** Read literally: the Hats logs of the grant's transaction are exactly
   `[HatMaxSupplyChanged?, TransferSingle]`.
4. **Small readings where a claim is silent:**
   - org.create 3 compares the Safe's owners as a set.
   - world.create 6 expects `WorldQuotaReached.owner` to be the first operator.
   - approval.sign 1 takes Brightside's address from the `supplier` fact's `capxul_wallet_address`.
5. **A start time with milliseconds.** An `Instant` carries milliseconds, but a block's timestamp is whole seconds,
   and neither world.create 2 nor decision 45 says what happens to a start with milliseconds. The platform could
   refuse it, round it and answer the rounded time, or keep the milliseconds in the clock but not on the chain.
   "two operators and their worlds" asks for a start already on a whole second, which avoids the question without
   settling it.
