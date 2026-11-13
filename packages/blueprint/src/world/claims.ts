// The acceptance claims of the world operations. Rendered into claims.md.
import { claim, dropped, kept, rewritten, type ClaimsOf } from "../claims/claim.ts";
import {
  ClockBackwards,
  ClockBeforeSeed,
  ExpiryBeyondSource,
  GradeNotOffered,
  NotWorldOwner,
  SnapshotExists,
  SnapshotNotFound,
  WorldExists,
  WorldNotFound,
  WorldQuotaReached,
} from "../errors.ts";
import { startingWorlds as w } from "../starting-worlds.ts";
import * as World from "./operations.ts";

export const create: ClaimsOf = {
  operation: World.create,
  claims: [
    claim(
      "A new world runs with its clock and a record that begins with its birth.",
      w.nothing,
      "world.create with a frozen clock answers state running, clock frozen, record head 1 and no parent. record.export at the new world's door lists exactly one entry, `world_created`, at seq 1, carrying what world.create answered.",
      { origin: kept("world.create/c-52e22ec1e2a6c1cc"), thinLine: true },
    ),
    claim(
      "A fresh world can begin before host time, though not before its seeded chain's last block, and an existing world's time cannot be reset.",
      w.nothing,
      "A start before the seeded chain's last block is refused with ClockBeforeSeed naming the earliest start. world.create with a frozen clock starting halfway between that earliest start and host time answers that time as its clock, and chain.head at the new world's door has that timestamp: a new world's chain mines a block at its start. Creating the same name again is refused with WorldExists naming its owner and expiry, and world.show shows the clock unchanged.",
      {
        refusals: [WorldExists, ClockBeforeSeed],
        origin: rewritten(
          "world.create/c-fc7bfdea5dd33f3e",
          "A fresh world can begin before host time, but an existing world's time cannot be reset.",
          "A world's chain is loaded from the seeded chain state, and a chain's time cannot go back past its last block.",
        ),
      },
    ),
    claim(
      "A real world is never made by this operation: asking for one is refused and nothing is made.",
      w.nothing,
      "world.create with grade real is refused with GradeNotOffered; world.show of the name is then refused with WorldNotFound.",
      {
        refusals: [GradeNotOffered],
        origin: rewritten(
          "world.create/c-4ee06f2f1dd89e20",
          "Production is never made without the platform owner's approval.",
          "Grades replace kinds. A real world is made by the platform's own deploy with Aaron's written go-ahead, never by this operation.",
        ),
      },
    ),
    claim(
      "Every world has an owner and an expiry: the caller owns the world it creates, and it expires after the lifetime asked for.",
      w.nothing,
      "world.create with a lifetime of 60 minutes answers the calling operator, the first operator `nothing`'s facts name, as owner and an expiry 60 minutes after the call, within a minute; world.show answers the same. world.create by the second operator answers the second operator as its owner.",
    ),
    claim(
      "A world is born with its cast: each person can call through the door and signs with a known test key, and everyone but pat holds a claimed personal Safe with 10,000 USDC.",
      w.nothing,
      "world.create lists dana, eli, sam, pat and olga, each with a signer address that is one of the well-known test keys; every one but pat has a Safe, and each Safe's balance of the world's USDC (chain.balance at the new world's door) is 10,000. record.export at the new world's door as each person is refused with NotWorldOwner, not NotSignedIn: the door signs each of them in.",
    ),
    claim(
      "An owner with as many live worlds as allowed is refused, and nothing is made.",
      w.quotaFull,
      "world.create is refused with WorldQuotaReached naming the owner, the live count and the limit; world.show of the name is refused with WorldNotFound.",
      { refusals: [WorldQuotaReached] },
    ),
  ],
  dropped: [
    dropped(
      "world.create/c-51839d5bf812fa32",
      "A `full` world gives each company a site on its own address and a `core` world gives none.",
      "There are no profiles. A company gets its site when it is founded (roadmap step 1.4), in every world.",
    ),
    dropped(
      "world.create/c-43a66f24b447122c",
      "A world made from a template starts with the template's companies on their own addresses.",
      "A world is made from a template by world.snapshot.restore, whose claims cover it.",
    ),
  ],
};

export const show: ClaimsOf = {
  operation: World.show,
  claims: [
    claim(
      "A world restored into another names its parent.",
      w.restored,
      "world.show of the restored world answers parent with the first world, `m3` and the record position `m3` holds.",
      { origin: kept("world.show/c-6aa449b0c9f7abaf"), thinLine: true },
    ),
    claim(
      "A world made from nothing names no parent, and a name with no world is refused.",
      w.nothing,
      "world.show of a world world.create has just made answers parent null. world.show of a name no world has is refused with WorldNotFound.",
      { refusals: [WorldNotFound] },
    ),
    claim(
      "It shows a world's owner, grade, expiry, clock, record head, cast and companies, each company with its site's state.",
      w.founded,
      "world.show answers the owner, grade, expiry, door, chain id, contracts and cast that the call that made the world answered (the `world` fact), a record head that matches record.export's, and northwind with its site ready at its own address.",
    ),
  ],
  dropped: [],
};

export const snapshotSave: ClaimsOf = {
  operation: World.snapshotSave,
  claims: [
    claim(
      "A snapshot saves everything that makes the world and leaves it untouched.",
      w.paid,
      "world.snapshot.save answers the record position it holds, the clock and one company. Afterwards record.export lists one new entry, `snapshot_saved`, and nothing else changed: world.show, the General Ledger and the USDC balances of the company Safe and every personal Safe (chain.balance) read the same as before. world.snapshot.restore of it is covered by that operation's claims.",
      { origin: kept("world.snapshot.save/c-69e4dbcdf13e3750"), thinLine: true },
    ),
    claim(
      "A name already saved is refused unless replacing is asked for, and the snapshot is unchanged.",
      w.withSnapshot,
      "world.snapshot.save of `m3` without replace is refused with SnapshotExists and the record gains no entry; with replace it answers a new record position.",
      { refusals: [SnapshotExists] },
    ),
    claim(
      "Only the world's owner may save a snapshot, and only of a world that exists.",
      w.fresh,
      "world.snapshot.save by the second operator (`operator: second`) is refused with NotWorldOwner naming the first operator as owner; of a name with no world, with WorldNotFound. The record gains no entry.",
      { refusals: [NotWorldOwner, WorldNotFound] },
    ),
  ],
  dropped: [],
};

export const snapshotRestore: ClaimsOf = {
  operation: World.snapshotRestore,
  claims: [
    claim(
      "A restore into a separate world leaves the first world untouched and the two never see each other.",
      w.withSnapshot,
      "world.snapshot.restore of `m3` as a new world answers a different door and the parent. A doc.create and an approval.sign of a held payment in each world (calls `at` the new world's door for the new one) appear in that world's record.export and General Ledger only, and the company Safe's USDC balance (chain.balance at each door) moves only in its own world.",
      { origin: kept("world.snapshot.restore/c-1dd79fdbcb1c0fd7"), thinLine: true },
    ),
    claim(
      "The new world holds what the snapshot saved: its record up to the snapshot, its clock, its people, companies, documents, balances and hats.",
      w.withSnapshot,
      "In the new world (calls `at` its door) record.export lists the first world's entries up to the snapshot's position, entry for entry, then one `world_created` naming the parent; the clock is the snapshot's; the General Ledger and Trial Balance read the same as in the first world at the save, and through each world's chain reads every Safe's USDC balance (chain.balance) and sam's Books hat (chain.wears) read the same as in the first world at the snapshot's block.",
    ),
    claim(
      "Anyone on the platform may restore a template snapshot; only the owner may restore any other.",
      w.withSnapshot,
      "The second operator (`operator: second`) restores `m3` and owns the new world: its owner is the second operator `nothing`'s facts name, and record.export at its door as the second operator answers. Restoring `draft` as the second operator is refused with NotWorldOwner naming the first operator.",
      { refusals: [NotWorldOwner] },
    ),
    claim(
      "A world made from a snapshot cannot outlive the world it came from.",
      w.withSnapshot,
      "A restore whose lifetime ends after the first world's expiry is refused with ExpiryBeyondSource naming the latest expiry allowed, and nothing is made.",
      { refusals: [ExpiryBeyondSource] },
    ),
    claim(
      "A snapshot that does not exist, or a new world's name that is taken, is refused and nothing is made.",
      w.withSnapshot,
      "A restore of `m9` is refused with SnapshotNotFound; a restore as the first world's own name is refused with WorldExists.",
      { refusals: [SnapshotNotFound, WorldExists] },
    ),
  ],
  dropped: [
    dropped(
      "world.snapshot.restore/c-369b1db183b9807f",
      "An in-place restore returns the world to the snapshot and records it.",
      "A world is never rewound in place. Going back is a restore into a new world, which costs a branch fork, keeps the record append-only and needs no epochs.",
    ),
  ],
};

export const clockWarp: ClaimsOf = {
  operation: World.clockWarp,
  claims: [
    claim(
      "A warp moves the chain and every site together and runs what fell due.",
      w.founded,
      "world.clock.warp by 7 days answers the clock a week on and one site. chain.head has a timestamp at or after it, and report.run of the Scheduled Job Log filtered to the Capxul app's daily job (Site.DAILY_JOB) shows it ran once for each day, 7 runs more than before. A warp to an earlier time is refused with ClockBackwards and the clock does not move.",
      { refusals: [ClockBackwards], origin: kept("world.clock.warp/c-2bceeaa41942995d"), thinLine: true },
    ),
    claim(
      "Only the world's owner may move the clock; a person of the world is refused and the clock does not move.",
      w.founded,
      "world.clock.warp as dana is refused with NotWorldOwner; world.show shows the clock unchanged.",
      { refusals: [NotWorldOwner] },
    ),
  ],
  dropped: [],
};
