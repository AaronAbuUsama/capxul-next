// world.snapshot.restore, claim 2: the new world holds what the snapshot saved: its record up to the snapshot, its
// clock, its people, companies, documents, balances and hats. Nothing has happened in the first world since the
// save but the save of `draft`, which moves neither its books nor its chain, so the first world now reads as it did
// at the save, and its chain at the latest block as at the snapshot's.
import { Site, startingWorlds } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Capxul } from "../client.ts";
import { expect, given, scenario } from "../scenario.ts";
import { present, same } from "../support/expect.ts";
import { mintedTo, usdc } from "../support/chain.ts";
import { ledger, report } from "../support/site.ts";
import { castMember, fieldOf, recordOf, view } from "../support/world.ts";
import { restoreInto, siteReady } from "./restore.ts";

export const worldSnapshotRestore2 = scenario(
  { operation: "world.snapshot.restore", claim: 2 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const facts = yield* given(startingWorlds.withSnapshot);
    const first = yield* view(facts.world.world);
    const position = facts.m3.recordSeq;
    const { as, made } = yield* restoreInto(first, "m3", "rs2");
    const at = { at: made.door };
    yield* same("the new world's parent", made.parent, { world: first.world, snapshot: "m3", recordSeq: position });
    yield* same("the new world's clock", made.clock, facts.m3.clock);
    yield* same("the new world's cast", made.cast, first.cast);
    const companies = (shown: typeof first) =>
      Arr.map(shown.companies, (each) => ({ org: each.org, handle: each.handle, name: each.name }));
    yield* same("the new world's companies", companies(made), companies(first));

    const theirs = yield* recordOf(at);
    const ours = yield* recordOf();
    yield* same("the new world's record head", theirs.head, position + 1);
    yield* same(
      "the new world's entries up to m3's position",
      Arr.take(theirs.entries, position),
      Arr.take(ours.entries, position),
    );
    const born = yield* present("the new world's last entry", Option.getOrNull(Arr.last(theirs.entries)));
    yield* same(
      "the new world's last entry",
      [born.seq, born.event, fieldOf(born.carried, "parent")],
      [position + 1, "world_created", made.parent],
    );

    yield* siteReady(as);
    const org = facts.founded.org;
    yield* same(
      "the new world's General Ledger",
      yield* ledger(org, {}, { at: made.door, as: "sam" }),
      yield* ledger(org, {}, { as: "sam" }),
    );
    yield* same(
      "the new world's Trial Balance",
      yield* report(org, Site.REPORTS.trialBalance, {}, { at: made.door, as: "sam" }),
      yield* report(org, Site.REPORTS.trialBalance, {}, { as: "sam" }),
    );

    const safes = [facts.founded.safe, ...Arr.flatMap(first.cast, (each) => (each.safe === null ? [] : [each.safe]))];
    for (const safe of safes)
      yield* same(`${safe}'s USDC in the new world`, yield* usdc(made, safe, at), yield* usdc(first, safe));

    const sam = yield* castMember(first, "sam");
    const samSafe = yield* present("sam's Safe", sam.safe);
    const granted = yield* capxul.chain.transaction({ transaction: facts.grantSent.transaction });
    const books = yield* present(
      "the Books hat minted to sam's Safe",
      Option.getOrNull(Arr.head(mintedTo(first, granted.logs, samSafe))),
    );
    const wears = (options: { readonly at?: string }) =>
      capxul.chain.wears({ hats: first.contracts.hats, hat: books.id, wearer: samSafe, block: null }, options);
    yield* expect(yield* wears({}), "sam's Safe does not wear the Books hat in the first world");
    yield* expect(yield* wears(at), "sam's Safe does not wear the Books hat in the new world");
  }),
);
