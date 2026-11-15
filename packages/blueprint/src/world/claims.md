# Acceptance claims of the domain `world`

Rendered from `claims.ts` here and the declarations by `pnpm claims`. Do not edit it by hand: a test fails when
this file and its sources differ. What the runner checks on every call, and the starting worlds a claim is in,
are in [claims.md](../../claims.md).

## Count

| Operation | Claims | Old, word for word | Old, rewritten | New | Old, not kept |
|---|---|---|---|---|---|
| `world.create` | 6 | 1 | 2 | 3 | 2 |
| `world.clock.warp` | 2 | 1 | 0 | 1 | 0 |
| `world.snapshot.save` | 3 | 1 | 0 | 2 | 0 |
| `world.snapshot.restore` | 5 | 1 | 0 | 4 | 1 |
| `world.show` | 3 | 1 | 0 | 2 | 0 |
| `world.list` | 2 | 0 | 0 | 2 | 0 |
| `world.snapshot.list` | 3 | 0 | 0 | 3 | 0 |
| `world.snapshot.delete` | 3 | 0 | 0 | 3 | 0 |

## 1. `world.create`

- Served by: the platform group.
- Refusals: `WorldExists`, `GradeNotOffered`, `WorldQuotaReached`, `ClockBeforeSeed`, `NotImplemented`, and `NotSignedIn` from sign-in.
- Emits: `world_created`.
- Budget: 90,000 ms, provisional. Basis: spikes/containers deployed a world with published images in 39 to 43 s and spikes/hosting made a Neon branch in 8 to 10 s; migrations, Core and the cast are not measured yet.

1. A new world runs with its clock and a record that begins with its birth. *(thin line)*
   - In: `nothing`.
   - Observes: world.create with a frozen clock answers state running, clock frozen, record head 1 and no parent. record.export at the new world's door lists exactly one entry, `world_created`, at seq 1, carrying what world.create answered.
   - Old: `acc:world.create/c-52e22ec1e2a6c1cc`, kept word for word.
2. A fresh world can begin before host time, though not before its seeded chain's last block, and an existing world's time cannot be reset.
   - In: `nothing`.
   - Observes: A start before the seeded chain's last block is refused with ClockBeforeSeed naming the earliest start. world.create with a frozen clock starting halfway between that earliest start and host time answers that time as its clock, and chain.head at the new world's door has that timestamp: a new world's chain mines a block at its start. Creating the same name again is refused with WorldExists naming its owner and expiry, and world.show shows the clock unchanged.
   - Refusals: `WorldExists`, `ClockBeforeSeed`.
   - Old: `acc:world.create/c-fc7bfdea5dd33f3e`, rewritten. It said: "A fresh world can begin before host time, but an existing world's time cannot be reset." Why: A world's chain is loaded from the seeded chain state, and a chain's time cannot go back past its last block.
3. A real world is never made by this operation: asking for one is refused and nothing is made.
   - In: `nothing`.
   - Observes: world.create with grade real is refused with GradeNotOffered; world.show of the name is then refused with WorldNotFound.
   - Refusals: `GradeNotOffered`.
   - Old: `acc:world.create/c-4ee06f2f1dd89e20`, rewritten. It said: "Production is never made without the platform owner's approval." Why: Grades replace kinds. A real world is made by the platform's own deploy with Aaron's written go-ahead, never by this operation.
4. Every world has an owner and an expiry: the caller owns the world it creates, and it expires after the lifetime asked for.
   - In: `nothing`.
   - Observes: world.create with a lifetime of 60 minutes answers the calling operator, the first operator `nothing`'s facts name, as owner and an expiry 60 minutes after the call, within a minute; world.show answers the same. world.create by the second operator answers the second operator as its owner.
   - Old: none; this claim is new.
5. A world is born with its cast: each person can call through the door and signs with a known test key, and everyone but pat holds a claimed personal Safe with 10,000 USDC.
   - In: `nothing`.
   - Observes: world.create lists dana, eli, sam, pat and olga, each with a signer address that is one of the well-known test keys; every one but pat has a Safe, and each Safe's balance of the world's USDC (chain.balance at the new world's door) is 10,000. record.export at the new world's door as each person is refused with NotWorldOwner, not NotSignedIn: the door signs each of them in.
   - Old: none; this claim is new.
6. An owner with as many live worlds as allowed is refused, and nothing is made.
   - In: `quota-full`.
   - Observes: world.create is refused with WorldQuotaReached naming the owner, the live count and the limit; world.show of the name is refused with WorldNotFound.
   - Refusals: `WorldQuotaReached`.
   - Old: none; this claim is new.

Old claims not kept:

- `acc:world.create/c-51839d5bf812fa32`: "A `full` world gives each company a site on its own address and a `core` world gives none." Why: There are no profiles. A company gets its site when it is founded (roadmap step 1.4), in every world.
- `acc:world.create/c-43a66f24b447122c`: "A world made from a template starts with the template's companies on their own addresses." Why: A world is made from a template by world.snapshot.restore, whose claims cover it.

## 2. `world.clock.warp`

- Served by: the world group.
- Refusals: `NotWorldOwner`, `ClockBackwards`, `NotImplemented`, and `NotSignedIn` from sign-in.
- Emits: `clock_warped`.
- Budget: 30,000 ms, provisional, excluding waking a parked world. Basis: a guess for a warp of up to a month that stops at every due instant; spikes/bench-clocks proved the sites follow but timed no warp.

1. A warp moves the chain and every site together and runs what fell due. *(thin line)*
   - In: `founded`.
   - Observes: world.clock.warp by 7 days answers the clock a week on and one site. chain.head has a timestamp at or after it, and report.run of the Scheduled Job Log filtered to the Capxul app's daily job (Site.DAILY_JOB) shows it ran once for each day, 7 runs more than before. A warp to an earlier time is refused with ClockBackwards and the clock does not move.
   - Refusals: `ClockBackwards`.
   - Old: `acc:world.clock.warp/c-2bceeaa41942995d`, kept word for word.
2. Only the world's owner may move the clock; a person of the world is refused and the clock does not move.
   - In: `founded`.
   - Observes: world.clock.warp as dana is refused with NotWorldOwner; world.show shows the clock unchanged.
   - Refusals: `NotWorldOwner`.
   - Old: none; this claim is new.

## 3. `world.snapshot.save`

- Served by: the platform group.
- Refusals: `WorldNotFound`, `NotWorldOwner`, `SnapshotExists`, `SnapshotInUse`, `NotImplemented`, and `NotSignedIn` from sign-in.
- Emits: `snapshot_saved`.
- Budget: 30,000 ms, provisional, excluding waking a parked world. Basis: a Neon branch takes 8 to 10 s (spikes/hosting) and saving the chain 0.8 to 2.1 s (spikes/containers); a site's backup is not measured.

1. A snapshot saves everything that makes the world and leaves it untouched. *(thin line)*
   - In: `paid`.
   - Observes: world.snapshot.save answers the record position it holds, the clock and one company. Afterwards record.export lists one new entry, `snapshot_saved`, and nothing else changed: world.show, the General Ledger and the USDC balances of the company Safe and every personal Safe (chain.balance) read the same as before. world.snapshot.restore of it is covered by that operation's claims.
   - Old: `acc:world.snapshot.save/c-69e4dbcdf13e3750`, kept word for word.
2. A name already saved is refused unless replacing is asked for, and the snapshot is unchanged.
   - In: `with-snapshot`.
   - Observes: world.snapshot.save of `m3` without replace is refused with SnapshotExists and the record gains no entry; with replace it answers a new record position.
   - Refusals: `SnapshotExists`.
   - Old: none; this claim is new.
3. Only the world's owner may save a snapshot, and only of a world that exists.
   - In: `fresh`.
   - Observes: world.snapshot.save by the second operator (`operator: second`) is refused with NotWorldOwner naming the first operator as owner; of a name with no world, with WorldNotFound. The record gains no entry.
   - Refusals: `NotWorldOwner`, `WorldNotFound`.
   - Old: none; this claim is new.

## 4. `world.snapshot.restore`

- Served by: the platform group.
- Refusals: `WorldNotFound`, `SnapshotNotFound`, `NotWorldOwner`, `WorldExists`, `ExpiryBeyondSource`, `WorldQuotaReached`, `NotImplemented`, and `NotSignedIn` from sign-in.
- Emits: `world_created`.
- Budget: 120,000 ms, provisional. Basis: a branch fork took 10 s (spikes/hosting) and a deploy 39 to 43 s (spikes/containers); restoring sites onto a bench is not measured.

1. A restore into a separate world leaves the first world untouched and the two never see each other. *(thin line)*
   - In: `with-snapshot`.
   - Observes: world.snapshot.restore of `m3` as a new world answers a different door and the parent. A doc.create and an approval.sign of a held payment in each world (calls `at` the new world's door for the new one) appear in that world's record.export and General Ledger only, and the company Safe's USDC balance (chain.balance at each door) moves only in its own world.
   - Old: `acc:world.snapshot.restore/c-1dd79fdbcb1c0fd7`, kept word for word.
2. The new world holds what the snapshot saved: its record up to the snapshot, its clock, its people, companies, documents, balances and hats.
   - In: `with-snapshot`.
   - Observes: In the new world (calls `at` its door) record.export lists the first world's entries up to the snapshot's position, entry for entry, then one `world_created` naming the parent; the clock is the snapshot's; the General Ledger and Trial Balance read the same as in the first world at the save, and through each world's chain reads every Safe's USDC balance (chain.balance) and sam's Books hat (chain.wears) read the same as in the first world at the snapshot's block.
   - Old: none; this claim is new.
3. Anyone on the platform may restore a template snapshot; only the owner may restore any other.
   - In: `with-snapshot`.
   - Observes: The second operator (`operator: second`) restores `m3` and owns the new world: its owner is the second operator `nothing`'s facts name, and record.export at its door as the second operator answers. Restoring `draft` as the second operator is refused with NotWorldOwner naming the first operator.
   - Refusals: `NotWorldOwner`.
   - Old: none; this claim is new.
4. A world made from a snapshot cannot outlive the world it came from.
   - In: `with-snapshot`.
   - Observes: A restore whose lifetime ends after the first world's expiry is refused with ExpiryBeyondSource naming the latest expiry allowed, and nothing is made.
   - Refusals: `ExpiryBeyondSource`.
   - Old: none; this claim is new.
5. A snapshot that does not exist, or a new world's name that is taken, is refused and nothing is made.
   - In: `with-snapshot`.
   - Observes: A restore of `m9` is refused with SnapshotNotFound; a restore as the first world's own name is refused with WorldExists.
   - Refusals: `SnapshotNotFound`, `WorldExists`.
   - Old: none; this claim is new.

Old claims not kept:

- `acc:world.snapshot.restore/c-369b1db183b9807f`: "An in-place restore returns the world to the snapshot and records it." Why: A world is never rewound in place. Going back is a restore into a new world, which costs a branch fork, keeps the record append-only and needs no epochs.

## 5. `world.show`

- Served by: the platform group.
- Refusals: `WorldNotFound`, `NotImplemented`, and `NotSignedIn` from sign-in.
- Emits: none.
- Budget: 2,000 ms, provisional. Basis: reads the registry and the world's database; spikes/hosting measured 350 to 450 ms for a query that wakes a Neon branch.

1. A world restored into another names its parent. *(thin line)*
   - In: `restored`.
   - Observes: world.show of the restored world answers parent with the first world, `m3` and the record position `m3` holds.
   - Old: `acc:world.show/c-6aa449b0c9f7abaf`, kept word for word.
2. A world made from nothing names no parent, and a name with no world is refused.
   - In: `nothing`.
   - Observes: world.show of a world world.create has just made answers parent null. world.show of a name no world has is refused with WorldNotFound.
   - Refusals: `WorldNotFound`.
   - Old: none; this claim is new.
3. It shows a world's owner, grade, expiry, clock, record head, cast and companies, each company with its site's state.
   - In: `founded`.
   - Observes: world.show answers the owner, grade, expiry, door, chain id, contracts and cast that the call that made the world answered (the `world` fact), a record head that matches record.export's, and northwind with its site ready at its own address.
   - Old: none; this claim is new.

## 6. `world.list`

- Served by: the platform group.
- Refusals: `NotImplemented`, and `NotSignedIn` from sign-in.
- Emits: none.
- Budget: 2,000 ms, provisional. Basis: reads the registry's rows of the caller's worlds and the platform's rows of their snapshots, one query each; wakes no world; not measured.

1. An operator lists exactly the worlds they own, each as world.show shows it, with how many snapshots it keeps. *(thin line)*
   - In: `quota-full`.
   - Observes: world.list by the first operator answers them as its owner, the limit of live worlds and every world `quota-full` filled, as many worlds as the limit; each with the grade, state, expiry, door and parent world.show answers, an owner who is the caller, and as many snapshots as world.snapshot.list lists. world.list by the second operator holds none of the first operator's worlds.
   - Old: none; this claim is new.
2. A world restored from another operator's template is listed by its new owner alone, naming where it came from.
   - In: `quota-full`.
   - Observes: After the second operator restores the first operator's template `base`, world.list by the second operator holds the new world, its parent the first operator's world and `base`; the first operator's list does not hold it, and lists their world with one snapshot once `scratch` is deleted.
   - Old: none; this claim is new.

## 7. `world.snapshot.list`

- Served by: the platform group.
- Refusals: `WorldNotFound`, `NotWorldOwner`, `NotImplemented`, and `NotSignedIn` from sign-in.
- Emits: none.
- Budget: 2,000 ms, provisional. Basis: reads the registry, the platform's rows of the world's snapshots and the branches of the platform's Neon project; wakes no world; not measured.

1. It lists every snapshot a world keeps, in the order they were saved, each as its save answered. *(thin line)*
   - In: `quota-full`.
   - Observes: After the first operator saves `base`, a template, and then `scratch` of a world they own, world.snapshot.list answers the world and both snapshots in that order, each exactly as world.snapshot.save answered it. The record gains no entry.
   - Old: none; this claim is new.
2. Each snapshot names the live worlds that hang from it.
   - In: `quota-full`.
   - Observes: After the second operator restores `base` as a world of their own, world.snapshot.list lists `base` in use by that world alone and `scratch` by none.
   - Old: none; this claim is new.
3. Only the world's owner may list its snapshots, and only of a world that exists.
   - In: `quota-full`.
   - Observes: world.snapshot.list by the second operator is refused with NotWorldOwner naming the first operator as owner; of a name with no world, with WorldNotFound naming it.
   - Refusals: `NotWorldOwner`, `WorldNotFound`.
   - Old: none; this claim is new.

## 8. `world.snapshot.delete`

- Served by: the platform group.
- Refusals: `WorldNotFound`, `NotWorldOwner`, `SnapshotNotFound`, `SnapshotInUse`, `NotImplemented`, and `NotSignedIn` from sign-in.
- Emits: `snapshot_deleted`.
- Budget: 15,000 ms, provisional, excluding waking a parked world. Basis: deletes a Neon branch with no compute and the chain's state saved under the snapshot's name in the bucket, then writes one record entry; not measured.

1. Deleting a snapshot removes it and records it, and leaves the world and its other snapshots as they were. *(thin line)*
   - In: `quota-full`.
   - Observes: world.snapshot.delete of `scratch` answers it as world.snapshot.list listed it. record.export lists one new entry, `snapshot_deleted`, carrying its world, its name and the record position it held; world.snapshot.list lists `base` alone, as before; world.show reads as before but for its record head, one higher. Deleting `scratch` again is refused with SnapshotNotFound.
   - Refusals: `SnapshotNotFound`.
   - Old: none; this claim is new.
2. A snapshot a live world hangs from cannot be deleted, and stays as it was.
   - In: `quota-full`.
   - Observes: world.snapshot.delete of `base`, from which the second operator restored a world, is refused with SnapshotInUse naming that world, as world.snapshot.list's `inUseBy` names it; world.snapshot.list lists `base` unchanged, the record gains no entry, and world.show of the restored world still names `base` as its parent.
   - Refusals: `SnapshotInUse`.
   - Old: none; this claim is new.
3. Only the world's owner may delete a snapshot, and only one that exists, of a world that exists.
   - In: `quota-full`.
   - Observes: world.snapshot.delete by the second operator is refused with NotWorldOwner naming the first operator; of a name with no world, with WorldNotFound; of `m9`, which was never saved, with SnapshotNotFound. The record gains no entry and world.snapshot.list lists the same snapshots.
   - Refusals: `NotWorldOwner`, `WorldNotFound`, `SnapshotNotFound`.
   - Old: none; this claim is new.
