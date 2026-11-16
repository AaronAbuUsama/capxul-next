// A run in one shared world plays each journey by its declared cast (worlds/players.ts): the makers' players are the
// journey's own, and every person of every journey's cast has a key the makers sign with. Without the second, every
// approval of a shared journey's starting world fails with "no test key signs as …" (the 🔍 review of #413).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Cast, Values } from "@capxul/blueprint";
import { Casting, declaredCast, journeys } from "@capxul/scenarios";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Str from "effect/String";
import { mnemonicToAccount } from "viem/accounts";
import { JourneyMaking, type MakingCall } from "../src/worlds/journey-making.ts";
import { castAccounts, playersNow } from "../src/worlds/players.ts";

test("every person of every journey's cast has a key the makers sign with", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const keys = Arr.map(yield* castAccounts, (account) => Str.toLowerCase(account.address));
      for (const key of Cast.JOURNEY_KEYS)
        for (const person of Cast.journeyCast(key, Cast.CAST_COMPANY).people) {
          const address = mnemonicToAccount(Values.CAST_KEYS.mnemonic, { addressIndex: person.keyIndex }).address;
          assert.ok(Arr.contains(keys, Str.toLowerCase(address)), `${person.person} (key ${String(person.keyIndex)})`);
        }
    }),
  ));

test("under Casting the makers play the journey's declared cast; without it each role by its own name", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls = yield* Ref.make<ReadonlyArray<MakingCall>>([]);
      for (const journey of journeys) {
        const cast = declaredCast(journey.key);
        const players = yield* playersNow.pipe(
          Effect.provideService(JourneyMaking, { calls, journey }),
          Effect.provideService(Casting, { castOf: (key) => Effect.succeed(declaredCast(key)) }),
        );
        assert.deepEqual(players, { ...cast.people, company: cast.company }, journey.name);
      }
      const uncast = yield* playersNow;
      assert.equal(uncast.dana, Cast.CAST_ROLES[0].role);
      assert.equal(uncast.company, Cast.CAST_COMPANY);
    }),
  ));
