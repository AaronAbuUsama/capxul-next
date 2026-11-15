// A new world's cast and its clock's start on its chain (packages/blueprint/docs/decisions.md, entries 20, 25 and 42).
// Every private and shared world is born with dana, eli, sam and olga, each with a personal Safe claimed through
// Companies House and funded with 10,000 test USDC from the faucet, and pat, who has not finished signing up and has no
// Safe. Each signs with one of the public test mnemonic's accounts (the blueprint's `CAST_KEYS`): 4 to 8, clear of the
// faucet's operator (0), Companies House's Directors (0 to 2), its claim service (3) and the bundler's keys (9 and 10).
//
// Every transaction that makes a world is sent with the chain's clock set just after the seed's last block (the
// create's `atSeed`), so the world's own start block, mined last, can be any time from `SETUP_ROOM_SECONDS` after the
// seed to host time.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { addressOf, callData } from "../../parts/chain/abi.ts";
import { CLAIMS, CONTRACTS } from "../../parts/chain/contracts.ts";
import { mintAll, type Call } from "../../parts/chain/faucet.ts";
import { PlatformFailed } from "../../common/failures.ts";
import { describeFailure } from "../../common/describe.ts";

/** One person of the cast: their name, the test account that signs for them, and whether they hold a Safe. */
export interface Person {
  readonly person: string;
  readonly signer: string;
  readonly claimed: boolean;
}

export const CAST: ReadonlyArray<Person> = [
  { person: "dana", signer: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65", claimed: true },
  { person: "eli", signer: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc", claimed: true },
  { person: "sam", signer: "0x976EA74026E726554dB657fA54763abd0C3a0aa9", claimed: true },
  { person: "pat", signer: "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955", claimed: false },
  { person: "olga", signer: "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f", claimed: true },
];

/** What each claimed Safe is given from the faucet: 10,000 USDC, in the token's smallest unit. */
export const CAST_FUNDS = 10_000_000_000n;

/** A person's email, from which Companies House derives their Safe. */
export const emailOf = (person: string): string => `${person}@cast.test`;

/** The cast as the world holds it: the blueprint's `CastMember`. */
export interface Member {
  readonly person: string;
  readonly email: string;
  readonly signer: string;
  readonly safe: string | null;
}

// Selectors, checked in test/abi.test.ts.
const EXEC_WITH_ROLE = "0xc6fe8747"; // execTransactionWithRole(address,uint256,bytes,uint8,bytes32,bool)
const CLAIM = "0x5cc2f461"; // claim(string,string,address)
const SAFE_ADDRESS_FOR = "0xcd9ad772"; // safeAddressFor(address,string,string)

const failed = (step: PlatformFailed["step"]) => (cause: unknown) =>
  PlatformFailed.make({ step, message: describeFailure(cause) });

const Hex = Schema.String.check(Schema.isPattern(/^0x[0-9a-fA-F]*$/));
const Receipt = Schema.Struct({ status: Schema.String });

/** Sends one transaction from an unlocked test account and insists that it succeeded. */
const sent = <E, R>(call: Call<E, R>, transaction: Record<string, string>) =>
  Effect.gen(function* () {
    const hash = yield* call("eth_sendTransaction", [transaction]).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Hex)),
    );
    const receipt = yield* call("eth_getTransactionReceipt", [hash]).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Receipt)),
      Effect.retry(Schedule.max([Schedule.spaced("500 millis"), Schedule.recurs(20)])),
    );
    if (receipt.status !== "0x1") return yield* failed("cast")(`${hash} reverted`);
    return hash;
  }).pipe(Effect.mapError(failed("cast")));

/** The Safe Companies House derives for an email. */
const safeOf = <E, R>(call: Call<E, R>, email: string) =>
  call("eth_call", [
    {
      to: CLAIMS.claimer,
      data: callData(SAFE_ADDRESS_FOR, [
        { address: CONTRACTS.companiesHouse },
        { string: CLAIMS.namespace },
        { string: email },
      ]),
    },
    "latest",
  ]).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Hex)),
    Effect.mapBoth({ onSuccess: addressOf, onFailure: failed("cast") }),
  );

/** Claims one person's Safe through Companies House's claim role and gives back its address. */
const claim = <E, R>(call: Call<E, R>, person: Person) =>
  Effect.gen(function* () {
    const email = emailOf(person.person);
    const inner = callData(CLAIM, [{ string: CLAIMS.namespace }, { string: email }, { address: person.signer }]);
    yield* sent(call, {
      from: CLAIMS.service,
      to: CLAIMS.roles,
      gas: "0x1e8480",
      data: callData(EXEC_WITH_ROLE, [
        { address: CLAIMS.claimer },
        { uint: 0n },
        { bytes: inner },
        { uint: 1n },
        { bytes32: CLAIMS.role },
        { bool: true },
      ]),
    });
    return yield* safeOf(call, email);
  });

/** Claims the cast's Safes, funds each from the faucet and gives back the cast as the world holds it. */
export const makeCast = Effect.fn("platform.cast")(function* <E, R>(call: Call<E, R>) {
  const members = yield* Effect.forEach(CAST, (person) =>
    Effect.map(
      person.claimed ? Effect.map(claim(call, person), (safe): string | null => safe) : Effect.succeed(null),
      (safe) => ({
        person: person.person,
        email: emailOf(person.person),
        signer: person.signer,
        safe,
      }),
    ),
  );
  const safes = Arr.flatMap(members, (member) => (member.safe === null ? [] : [member.safe]));
  yield* mintAll(
    call,
    Arr.map(safes, (to) => ({ to, amount: CAST_FUNDS })),
  ).pipe(Effect.mapError(failed("cast")));
  return members satisfies ReadonlyArray<Member>;
});

/**
 * Mines the world's first block of its own at its start, so the chain's head shows the world's clock
 * (packages/blueprint/docs/decisions.md, entry 34).
 */
export const mineStart = <E, R>(call: Call<E, R>, startMs: number) =>
  Effect.gen(function* () {
    yield* call("evm_setNextBlockTimestamp", [Math.floor(startMs / 1000)]);
    yield* call("evm_mine", []);
  }).pipe(Effect.mapError(failed("clock")));

const Head = Schema.Struct({ timestamp: Schema.String });

/**
 * Mines a block at the world's time `worldMs`, or one second after the chain's head when that is later, so the chain's
 * head shows the world's clock and anvil runs on from there with host time, as a running clock does. A restored
 * world needs it: its chain's state is loaded with the snapshot's head, and anvil runs on from that head, while Core's
 * clock reads the snapshot's time (spikes/world-speed, 6.1 and 6.3). The same as world.clock.warp's move of the chain
 * (packages/core, src/things/site-ops/chain-time.ts).
 */
export const mineAtWorldTime = <E, R>(call: Call<E, R>, worldMs: number) =>
  Effect.gen(function* () {
    const head = yield* Effect.flatMap(
      call("eth_getBlockByNumber", ["latest", false]),
      Schema.decodeUnknownEffect(Head),
    );
    const next = Math.max(Math.ceil(worldMs / 1000), Number(BigInt(head.timestamp)) + 1);
    yield* call("evm_setNextBlockTimestamp", [next]);
    yield* call("evm_mine", []);
    return next;
  }).pipe(Effect.mapError(failed("clock")));
