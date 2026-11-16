// The world test/chain runs Core's chain operations in: Core served in this process against a local Anvil, alto and
// Postgres (up.sh), with the world's cast made the way a world makes it (each personal Safe claimed through Companies
// House's claim role and funded from the faucet, pat with none), and a site door in memory that makes every site
// ready on its second look and keeps what each site was told.
import {
  CREDENTIAL_HEADER,
  type Organizations,
  PERSON_HEADER,
  TRACE_HEADER,
  Values,
  WorldRpcs,
} from "@capxul/blueprint";
import { Abi as Contracts } from "@capxul/contracts";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Random from "effect/Random";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Str from "effect/String";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as RpcClient from "effect/rpc/RpcClient";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import * as RpcTest from "effect/rpc/RpcTest";
import * as PgClient from "@effect/sql-pg/PgClient";
import { type Abi, decodeEventLog, encodeFunctionData, padHex, stringToHex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { Cast } from "../../src/cast/Cast.ts";
import { readContract, receiptOf, sendAsService } from "../../src/chain/calls.ts";
import { hex, sameAddress } from "../../src/chain/hex.ts";
import { SEEDED, TIER } from "../../src/chain/seeded.ts";
import { WorldChain } from "../../src/chain/WorldChain.ts";
import { topicsOf } from "../../src/organizations/found.ts";
import { CoreIdentity, Served, SiteDoor, ExportedSpans, type SiteCall } from "../../src/door.ts";
import { siteOpsLive } from "../../src/site-ops/door.ts";

export interface Urls {
  readonly rpc: string;
  readonly bundler: string;
  readonly database: string;
}

/** The cast: each person and the index of their key among the public test accounts. pat has no Safe. */
export const CAST = [
  { person: "dana", key: 1, safe: true },
  { person: "eli", key: 2, safe: true },
  { person: "sam", key: 5, safe: true },
  { person: "pat", key: 6, safe: false },
  { person: "olga", key: 7, safe: true },
] as const;

/** The test key of a person of the cast. */
export const keyOf = (person: string) =>
  mnemonicToAccount("test test test test test test test test test test test junk", {
    addressIndex: Option.getOrElse(
      Option.map(
        Arr.findFirst(CAST, (each) => each.person === person),
        (each) => each.key,
      ),
      () => 0,
    ),
  });

/** A person's signature of a digest, with their own test key. */
export const signed = (person: string, digest: string) =>
  Effect.promise(() => keyOf(person).sign({ hash: hex(digest) }));

const CLAIMER = Contracts.CompaniesHouseClaimer;
const ROLES = Contracts.IRoles;
const MINT = Contracts.MockERC20;

/** A site door in memory: every site is ready on its second look; every call to a site is kept and answered 200. */
export const fakeSiteDoor = Effect.gen(function* () {
  const looks = yield* Ref.make<Readonly<Record<string, number>>>({});
  const told = yield* Ref.make<ReadonlyArray<{ readonly site: string; readonly call: SiteCall }>>([]);
  const door = SiteDoor.of({
    sites: Effect.succeed({ world: "test", sites: [] }),
    clock: (clock) =>
      Effect.as(
        Ref.update(told, (all) => [
          ...all,
          { site: "", call: { method: "POST" as const, path: "/clock", body: clock } },
        ]),
        { status: 200, body: {} },
      ),
    make: (label) => Effect.succeed({ site: `${label}-test.worlds.test`, state: "creating" }),
    site: (site) =>
      Ref.modify(looks, (seen) => {
        const n = (seen[site] ?? 0) + 1;
        return [
          { site, state: n >= 2 ? "ready" : "creating" },
          { ...seen, [site]: n },
        ];
      }),
    remove: () => Effect.void,
    call: (site, call) =>
      Effect.as(
        Ref.update(told, (all) => [...all, { site, call }]),
        { status: 200, body: { message: "ok" } },
      ),
  });
  return { layer: Layer.succeed(SiteDoor, door), told };
});

const IDENTITY = {
  world: "test",
  owner: "ci",
  doorToken: Redacted.make("door-token"),
  platformToken: Redacted.make("platform-token"),
};

/** Core's groups served in this process, with every service the three operations need, at these addresses. */
export const core = (urls: Urls, site: Layer.Layer<SiteDoor>) => {
  const chain = WorldChain.at({ rpc: Redacted.make(urls.rpc), bundler: Redacted.make(urls.bundler) }).pipe(
    Layer.provide(FetchHttpClient.layer),
  );
  return Served.pipe(
    Layer.provide(ExportedSpans),
    Layer.provide(Layer.succeed(CoreIdentity, IDENTITY)),
    Layer.provideMerge(siteOpsLive({})),
    Layer.provideMerge(Layer.mergeAll(chain, site, Cast.fromDatabase)),
    Layer.provideMerge(PgClient.layer({ url: Redacted.make(urls.database) })),
  );
};

type Client = RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof WorldRpcs>>;
type Headers = Readonly<Record<string, string>>;

/** One call through the world's door as `person` (null: the owner), under a trace of its own: how it ended. */
export const asPerson = <A, E, R>(
  person: string | null,
  use: (client: Client, options: { readonly headers: Headers }) => Effect.Effect<A, E, R>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const digits = yield* Effect.forEach(Arr.range(1, 32), () => Random.nextIntBetween(0, 16));
      const trace = Arr.join(
        Arr.map(digits, (digit) => (digit % 16).toString(16)),
        "",
      );
      const headers = {
        [CREDENTIAL_HEADER]: "Bearer door-token",
        [TRACE_HEADER]: `00-${trace}-${Str.repeat(16)("1")}-01`,
        ...(person === null ? {} : { [PERSON_HEADER]: person }),
      };
      const client = yield* RpcTest.makeClient(WorldRpcs, { flatten: true });
      return { exit: yield* Effect.exit(use(client, { headers })), trace };
    }),
  );

/** Applies the SQL files, in order, to the world's database, one statement at a time (the driver takes one). */
export const migrate = (files: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    yield* sql.unsafe("drop schema if exists app cascade");
    const statements = Arr.flatMap(files, (text) =>
      Arr.filter(Str.split(text, /;\s*\n/), (each) => Str.trim(Str.replace(/--[^\n]*/g, "")(each)) !== ""),
    );
    yield* Effect.forEach(statements, (statement) => sql.unsafe(statement), { discard: true });
  });

const roleKey = (name: string) => padHex(stringToHex(name), { dir: "right", size: 32 });

/**
 * Claims one person's Safe through Companies House and funds it with 10,000 USDC from the faucet; a Safe the chain
 * already holds, from an earlier file of this run, is kept as it is.
 */
const claim = (email: string, signer: string) =>
  Effect.gen(function* () {
    const chain = yield* WorldChain;
    const safe = yield* readContract({
      address: SEEDED.claimer,
      abi: CLAIMER,
      functionName: "safeAddressFor",
      args: [SEEDED.companiesHouse, TIER.personalNamespace, email],
    });
    if ((yield* chain.rpc("eth_getCode", [safe, "latest"])) !== "0x") return safe;
    const call = encodeFunctionData({
      abi: CLAIMER,
      functionName: "claim",
      args: [TIER.personalNamespace, email, hex(signer)],
    });
    const viaRole = encodeFunctionData({
      abi: ROLES,
      functionName: "execTransactionWithRole",
      args: [SEEDED.claimer, 0n, call, 1, roleKey(TIER.claimRole), true],
    });
    yield* sendAsService(SEEDED.companiesHouseRoles, viaRole);
    const mint = encodeFunctionData({ abi: MINT, functionName: "mint", args: [safe, 10_000_000_000n] });
    yield* sendAsService(SEEDED.usdc, mint, 200_000n);
    return safe;
  });

/** Makes the cast, as the world writes it (`app.cast`). */
export const makeCast = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  yield* Effect.forEach(
    CAST,
    (each, position) =>
      Effect.gen(function* () {
        const email = `${each.person}@cast.test`;
        const signer = keyOf(each.person).address;
        const safe = each.safe ? yield* claim(email, signer) : null;
        yield* sql`insert into app.cast ${sql.insert({ person: each.person, position, email, signer, safe })}`;
      }),
    { discard: true },
  );
});

/** What a call recorded in the world's record, by its trace. */
export const eventsOf = (trace: string) =>
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    return yield* sql<{ readonly event: string; readonly payload: unknown }>`
      select event, payload from app.events where trace_id = ${trace} order by id`;
  });

/** How many entries the world's record holds. */
export const recordSize = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const [row] = yield* sql<{ readonly n: string }>`select count(*)::text as n from app.events`;
  return Number(row?.n);
});

/** A person's Safe, from the cast. */
export const safeOf = (person: string) =>
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    const [row] = yield* sql<{ readonly safe: string }>`select safe from app.cast where person = ${person}`;
    return hex(row?.safe ?? "");
  });

/** The logs of `abi`'s events from `address` in a transaction, decoded, in order; any other log left out. */
export const logsOf = <const A extends Abi>(transaction: string, address: string, abi: A) =>
  Effect.map(receiptOf(transaction), (receipt) =>
    Arr.flatMap(receipt.logs, (log) => {
      if (!sameAddress(log.address, address)) return [];
      const decoded = Option.liftThrowable(() =>
        decodeEventLog({ abi, topics: topicsOf(log.topics), data: hex(log.data) }),
      )();
      return Option.isSome(decoded) ? [decoded.value] : [];
    }),
  );

/** What a call answered, or the call's failure as a defect of the test. */
export const answer = <A, E>(ended: { readonly exit: Exit.Exit<A, E> }) =>
  Exit.isSuccess(ended.exit) ? Effect.succeed(ended.exit.value) : Effect.die(ended.exit.cause.pipe(Cause.pretty));
/** The refusal a call answered, or a defect of the test when it succeeded or died. */
export const refusal = <A, E>(ended: { readonly exit: Exit.Exit<A, E> }) =>
  Exit.isFailure(ended.exit)
    ? ended.exit.cause.pipe(Cause.findErrorOption, Effect.fromOption, Effect.orDie)
    : Effect.die("it did not refuse");
export const sign = (approval: typeof Values.Approval.Type, as = approval.signer, key = approval.signer) =>
  Effect.flatMap(signed(key, approval.digest), (signature) =>
    asPerson(as, (client, options) => client("approval.sign", { approval: approval.id, signature }, options)),
  );
export const lower = (addresses: ReadonlyArray<string>) => Arr.sort(Arr.map(addresses, Str.toLowerCase), Order.String);
export const events = (trace: string) => Effect.map(eventsOf(trace), (rows) => Arr.map(rows, (row) => row.event));

/** The logs the claims read, by the contracts that emit them. */
export const HAT_LOGS = Contracts.IHatsEvents;
export const PAID = Contracts.Payments;
export const OPERATIONS = Contracts.IEntryPoint;

/** Northwind's founding, as the starting world `founded` makes it, and others like it. */
export type Founding = typeof Organizations.create.rpc.payloadSchema.Type;
export const FOUNDING: Founding = {
  handle: "northwind",
  profile: { name: "Northwind Trading", country: "NL", bio: "We keep offices clean.", size: "2-10" },
  directors: ["eli"],
  threshold: 2,
  members: ["sam", "pat"],
  capital: { asset: "USDC", amount: "1000" },
};
export const variant = (change: Partial<Founding>): Founding => ({ ...FOUNDING, ...change });
