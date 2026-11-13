// The chain operations' journey through a world `world create` made (`./run.sh chain --world=<name>`): org.create
// founds northwind as dana, dana's and eli's signatures of the setup send it, a grant of manage-books to sam is
// proposed and executed the same way, and the chain is read back through the world's door after each landing. Every
// call goes through the recording client, so each gets the generic checks and its timings in the run record.
//
// It needs the world's cast (`app.cast`, with dana, eli and sam's claimed Safes): until world.create makes the cast
// (roadmap step 1.12), whoever runs it makes the cast first. It proves no claim of its own: the scenarios do, once
// their starting worlds exist.
import { Values } from "@capxul/blueprint";
import { Capxul, ExpectationFailed } from "@capxul/scenarios";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { type Hex, isHex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { TEST_USDC } from "@capxul/world";
import { capxulFor } from "./client.ts";
import type { Plan } from "./run.ts";

/** The cast's keys, by person, as the world's cast names them: indexes into the public test mnemonic. */
export const CAST_KEYS_BY_PERSON: Readonly<Record<string, number>> = { dana: 1, eli: 2, sam: 5, olga: 7 };

const expectThat = (holds: boolean, message: string) =>
  holds ? Effect.void : Effect.fail(ExpectationFailed.make({ message }));

const hex = (text: string): Hex => (isHex(text) ? text : "0x");

/** The signature of an approval's digest by its signer's own test key. */
const signatureOf = (approval: typeof Values.Approval.Type) =>
  Effect.promise(() =>
    mnemonicToAccount(Values.CAST_KEYS.mnemonic, {
      addressIndex: CAST_KEYS_BY_PERSON[approval.signer] ?? 0,
    }).sign({ hash: hex(approval.digest) }),
  );

const signAll = (approvals: ReadonlyArray<typeof Values.Approval.Type>) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    return yield* Effect.forEach(approvals, (approval) =>
      Effect.flatMap(signatureOf(approval), (signature) =>
        capxul["approval.sign"]({ approval: approval.id, signature }, { as: approval.signer }),
      ),
    );
  });

const journey = Effect.gen(function* () {
  const capxul = yield* Capxul;
  const founded = yield* capxul["org.create"](
    {
      handle: "northwind",
      profile: { name: "Northwind Trading", country: "NL", bio: null, size: null },
      directors: ["eli"],
      threshold: 2,
      members: ["sam", "pat"],
      capital: { asset: "USDC", amount: "1000" },
    },
    { as: "dana" },
  );
  if (founded._tag !== "Founded") return yield* expectThat(false, `org.create answered ${founded._tag}`);
  const setup = yield* signAll(founded.approvals);
  yield* expectThat(
    Arr.join(
      Arr.map(setup, (each) => each._tag),
      " ",
    ) === "Collected Sent",
    `the setup's signatures answered ${Arr.join(
      Arr.map(setup, (each) => each._tag),
      ", ",
    )}`,
  );
  const board = yield* capxul.chain.safe({ safe: founded.safe, block: null });
  yield* expectThat(
    board.threshold === 2 && board.owners.length === 2,
    `the company Safe's board is ${board.owners.length} of ${board.threshold}`,
  );
  const capital = yield* capxul.chain.balance({ token: TEST_USDC, holder: founded.safe, block: null });
  yield* expectThat(capital === "1000", `the company Safe holds ${capital} USDC, not the founder's 1000`);

  const grant = yield* capxul["org.member.grant"](
    { org: founded.org, member: "sam", permission: "manage-books", note: "Sam keeps the books" },
    { as: "dana" },
  );
  const granted = yield* signAll(grant.approvals);
  const sent = Option.getOrNull(Arr.findFirst(granted, (each) => each._tag === "Sent"));
  if (sent === null || sent._tag !== "Sent") return yield* expectThat(false, "the grant was not sent");
  const landed = yield* capxul.chain.transaction({ transaction: sent.transaction });
  return yield* expectThat(
    landed.status === "success" && Arr.some(landed.logs, (log) => log._tag === "TransferSingle"),
    "the grant's transaction minted no hat",
  );
});

/** The journey as a run in a world, with every call recorded and checked. */
export const chainJourney: Plan = {
  kind: "door",
  name: "the chain operations through a world: a company founded and set up, an officer granted",
  proves: null,
  given: null,
  calls: (target, log) =>
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- the journey is its own program, handed the world's client
    Effect.provide(journey, capxulFor(target, log)),
};
