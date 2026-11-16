// A new world's cast and its clock's start on its chain (packages/blueprint, src/things/world/verbs/create.ts,
// src/starting-points/cast.ts and src/common/values.ts).
// Every private and shared world is born with dana, eli, sam and olga, each with a personal Safe claimed through
// Companies House and funded with 10,000 test USDC from the faucet, and pat, who has not finished signing up and has no
// Safe. Each signs with one of the public test mnemonic's accounts (the blueprint's `CAST_KEYS`): 4 to 8, clear of the
// faucet's operator (0), Companies House's Directors (0 to 2), its claim service (3) and the bundler's keys (9 and 10).
//
// Beside them, every journey the blueprint declares has a cast of its own (roadmap step 4.11, "a cast per journey";
// packages/blueprint, src/starting-points/cast.ts), so journeys run side by side in one world without sharing a
// person, a Safe or its nonce: dana-j1, eli-j1, ... olga-j8, signing with the test mnemonic's accounts 28 to 88.
//
// Every transaction that makes a world is sent with the chain's clock set just after the seed's last block (the
// create's `atSeed`), so the world's own start block, mined last, can be any time from `SETUP_ROOM_SECONDS` after the
// seed to host time.
import { Cast, Values } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { toHex } from "viem";
import { addressOf, callData } from "../../parts/chain/abi.ts";
import { CLAIMS, CONTRACTS } from "../../parts/chain/contracts.ts";
import { FAUCET_OPERATOR, TEST_USDC, mintCall, type Call } from "../../parts/chain/faucet.ts";
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

/** The company a journey's story names: its people do not depend on it, only its handle does. */
const COMPANY = "northwind";

/** The path of the test mnemonic's accounts, without the account's own index. */
const ACCOUNTS_PATH = "m/44'/60'/0'/0";

/** The test mnemonic's accounts at `indexes`, derived from their common path's key, the seed worked out once. */
export const signersAt = (indexes: ReadonlyArray<number>) =>
  Effect.suspend(() => {
    const parent = mnemonicToAccount(Values.CAST_KEYS.mnemonic, { path: ACCOUNTS_PATH }).getHdKey();
    return Effect.forEach(indexes, (index) =>
      Effect.map(
        Effect.fromNullishOr(parent.deriveChild(index).privateKey),
        (key): string => privateKeyToAccount(toHex(key)).address,
      ),
    );
  }).pipe(Effect.orDie);

/**
 * Every journey's own cast, as the blueprint declares it (`Cast.JOURNEY_KEYS`, `Cast.journeyCast`), so journeys can
 * run side by side in one world: `<role>-j<n>` for each role of journey `n`, signing with the test mnemonic's
 * account the blueprint gives them, a Safe claimed and funded for every role that holds one.
 */
export const journeyPeople = Effect.fn("world.cast.journeys")(function* () {
  const people = Arr.flatMap(Cast.JOURNEY_KEYS, (key) => Cast.journeyCast(key, COMPANY).people);
  const signers = yield* signersAt(Arr.map(people, (each) => each.keyIndex));
  return Arr.zipWith(people, signers, (each, signer): Person => ({
    person: each.person,
    signer,
    claimed: each.claimed,
  }));
});

/** What each claimed Safe is given from the faucet: 10,000 USDC, in the token's smallest unit. */
export const CAST_FUNDS = 10_000_000_000n;

/** A person's email, from which Companies House derives their Safe. */
export const emailOf = (person: string): string => Cast.castEmail(person);

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

/** A JSON-RPC quantity as a number of the chain's. */
const quantity = <E, R>(answer: Effect.Effect<unknown, E, R>) =>
  answer.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Hex)), Effect.map(BigInt));

/** One transaction of the cast, with what it is for, so a failure names it. */
export interface Send {
  readonly label: string;
  readonly transaction: Record<string, string>;
}

/** A failure of the cast that names the transaction it is about. */
const named = (send: Send, what: string) => (cause: unknown) =>
  failed("cast")({ message: `${send.label}: ${what}: ${describeFailure(cause)}` });

/** How many transactions of one sender are in flight at once. */
const IN_FLIGHT = 16;

/** What the chain says when a transaction's nonce does not fit: the sign to send one at a time instead. */
const NONCE_TROUBLE = /nonce|replacement|underpriced/i;

const nonceOf = (n: bigint): string => `0x${n.toString(16)}`;

/**
 * Sends one test account's transactions side by side, each with its own nonce, and fails naming any that fails. One
 * the chain refuses for its nonce is sent again on its own, in order, rather than failing the world.
 */
export const sendAll = Effect.fn("world.cast.send")(function* <E, R>(
  call: Call<E, R>,
  from: string,
  sends: ReadonlyArray<Send>,
) {
  // Insists that a transaction was mined and succeeded.
  const succeeded = (send: Send, hash: string) =>
    Effect.gen(function* () {
      const receipt = yield* call("eth_getTransactionReceipt", [hash]).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Receipt)),
        Effect.retry(Schedule.max([Schedule.spaced("500 millis"), Schedule.recurs(20)])),
        Effect.mapError(named(send, `no receipt for ${hash}`)),
      );
      if (receipt.status !== "0x1") return yield* failed("cast")({ message: `${send.label}: ${hash} reverted` });
      return hash;
    });
  // Sends one transaction with the nonce the chain has mined up to, once those before it are in.
  const oneByOne = (send: Send) =>
    Effect.gen(function* () {
      const mined = yield* quantity(call("eth_getTransactionCount", [from, "latest"]));
      return yield* call("eth_sendTransaction", [{ ...send.transaction, from, nonce: nonceOf(mined) }]).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Hex)),
      );
    }).pipe(
      Effect.mapError(named(send, "sent one by one")),
      Effect.tap((hash) => succeeded(send, hash)),
    );
  const next = yield* quantity(call("eth_getTransactionCount", [from, "pending"])).pipe(
    Effect.mapError((cause) => failed("cast")({ message: `${from}'s next nonce: ${describeFailure(cause)}` })),
  );
  const first = yield* Effect.forEach(
    sends,
    (send, index) =>
      Effect.result(
        call("eth_sendTransaction", [{ ...send.transaction, from, nonce: nonceOf(next + BigInt(index)) }]).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Hex)),
        ),
      ),
    { concurrency: IN_FLIGHT },
  );
  const hashes = yield* Effect.forEach(Arr.zip(sends, first), ([send, sent]) => {
    if (Result.isSuccess(sent)) return Effect.succeed(sent.success);
    return NONCE_TROUBLE.test(describeFailure(sent.failure))
      ? oneByOne(send)
      : Effect.fail(named(send, "not sent")(sent.failure));
  });
  return yield* Effect.forEach(Arr.zip(sends, hashes), ([send, hash]) => succeeded(send, hash), {
    concurrency: IN_FLIGHT,
  });
});

/** The Safe Companies House derives for an email, whether or not it is claimed yet. */
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

/** The transaction that gives one person their Safe through Companies House's role for it, sent by its service. */
const claimOf = (member: Member): Send => ({
  label: `${member.person}'s Safe`,
  transaction: {
    to: CLAIMS.roles,
    gas: "0x1e8480",
    data: callData(EXEC_WITH_ROLE, [
      { address: CLAIMS.claimer },
      { uint: 0n },
      { bytes: callData(CLAIM, [{ string: CLAIMS.namespace }, { string: member.email }, { address: member.signer }]) },
      { uint: 1n },
      { bytes32: CLAIMS.role },
      { bool: true },
    ]),
  },
});

/** The faucet's transaction that gives one Safe its funds. */
const mintOf = (member: Member, safe: string): Send => ({
  label: `${member.person}'s funds`,
  transaction: { to: TEST_USDC, gas: "0x30d40", data: mintCall({ to: safe, amount: CAST_FUNDS }) },
});

/** How many persons are read at once. */
const READS = 16;

/**
 * Claims the Safes of the world's cast and of every journey's, funds each from the faucet and gives back the cast as
 * the world holds it. A Safe's address depends only on its email, so every Safe is read first; then the claims (all
 * from Companies House's service) and the mints to the Safes (all from the faucet's operator) go side by side, each sender's
 * transactions at once.
 */
export const makeCast = Effect.fn("platform.cast")(function* <E, R>(call: Call<E, R>) {
  const began = yield* Clock.currentTimeMillis;
  const everyone = [...CAST, ...(yield* journeyPeople())];
  const members = yield* Effect.forEach(
    everyone,
    (person) =>
      Effect.map(
        person.claimed
          ? Effect.map(safeOf(call, emailOf(person.person)), (safe): string | null => safe)
          : Effect.succeed(null),
        (safe): Member => ({ person: person.person, email: emailOf(person.person), signer: person.signer, safe }),
      ),
    { concurrency: READS },
  );
  const claimed = Arr.filter(members, (member) => member.safe !== null);
  yield* Effect.all(
    [
      sendAll(call, CLAIMS.service, Arr.map(claimed, claimOf)),
      sendAll(
        call,
        FAUCET_OPERATOR,
        Arr.flatMap(claimed, (member) => (member.safe === null ? [] : [mintOf(member, member.safe)])),
      ),
    ],
    { concurrency: 2 },
  );
  const tookMs = (yield* Clock.currentTimeMillis) - began;
  yield* Effect.logInfo(
    `the cast: ${members.length} persons, ${claimed.length} Safes claimed and funded in ${tookMs} ms`,
  );
  yield* Effect.annotateCurrentSpan({ persons: members.length, safes: claimed.length, tookMs });
  return members satisfies ReadonlyArray<Member>;
});

/**
 * Mines the world's first block of its own at its start, so the chain's head shows the world's clock
 * (packages/blueprint, src/common/chain/reads.ts).
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
