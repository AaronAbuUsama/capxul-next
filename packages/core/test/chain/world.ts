// The world test/chain runs Core's chain operations in: Core served in this process against a local Anvil, alto and
// Postgres (up.sh), with the world's cast made the way a world makes it (each personal Safe claimed through Companies
// House's claim role and funded from the faucet, pat with none), and a site door in memory that makes every site
// ready on its second look and keeps what each site was told.
import { CREDENTIAL_HEADER, PERSON_HEADER, TRACE_HEADER } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Str from "effect/String";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as RpcTest from "effect/rpc/RpcTest";
import * as PgClient from "@effect/sql-pg/PgClient";
import { encodeFunctionData, padHex, parseAbi, stringToHex, type Hex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { Cast } from "../../src/cast/Cast.ts";
import { readContract, sendAsService } from "../../src/chain/calls.ts";
import { SEEDED, TIER } from "../../src/chain/seeded.ts";
import { WorldChain } from "../../src/chain/WorldChain.ts";
import { CoreIdentity, CoreRpcs, Served, SiteDoor, SqlSpanSink, type SiteCall } from "../../src/door.ts";

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

export const keyOf = (person: string) =>
  mnemonicToAccount("test test test test test test test test test test test junk", {
    addressIndex: Arr.findFirst(CAST, (each) => each.person === person).pipe((found) => (found._tag === "Some" ? found.value.key : 0)),
  });

const CLAIMER = parseAbi([
  "function claim(string namespace, string email, address signer) returns (address)",
  "function safeAddressFor(address owner, string namespace, string email) pure returns (address)",
]);
const ROLES = parseAbi([
  "function execTransactionWithRole(address to, uint256 value, bytes data, uint8 operation, bytes32 roleKey, bool shouldRevert) returns (bool)",
]);
const MINT = parseAbi(["function mint(address to, uint256 amount)"]);

/** A site door in memory: every site is ready on its second look; every call to a site is kept and answered 200. */
export const fakeSiteDoor = Effect.gen(function* () {
  const looks = yield* Ref.make<Record<string, number>>({});
  const told = yield* Ref.make<ReadonlyArray<{ readonly site: string; readonly call: SiteCall }>>([]);
  const door = SiteDoor.of({
    sites: Effect.succeed({ world: "test", sites: [] }),
    make: (label) => Effect.succeed({ site: `${label}-test.worlds.test`, state: "creating" }),
    site: (site) =>
      Ref.modify(looks, (seen) => {
        const n = (seen[site] ?? 0) + 1;
        return [{ site, state: n >= 2 ? "ready" : "creating" }, { ...seen, [site]: n }];
      }),
    call: (site, call) => Effect.as(Ref.update(told, (all) => [...all, { site, call }]), { status: 200, body: { message: "ok" } }),
  });
  return { layer: Layer.succeed(SiteDoor, door), told };
});

/** Everything Core's three operations need, at these addresses. */
export const services = (urls: Urls, site: Layer.Layer<SiteDoor>) => {
  const database = PgClient.layer({ url: Redacted.make(urls.database) });
  const chain = WorldChain.at({ rpc: Redacted.make(urls.rpc), bundler: Redacted.make(urls.bundler) }).pipe(
    Layer.provide(FetchHttpClient.layer),
  );
  return Layer.mergeAll(chain, site, Cast.fromDatabase).pipe(Layer.provideMerge(database));
};

const IDENTITY = {
  world: "test",
  owner: "ci",
  doorToken: Redacted.make("door-token"),
  platformToken: Redacted.make("platform-token"),
};

/** Core's groups served in this process, over `services`. */
export const core = (deps: Layer.Layer<never, never, never> | Layer.Layer<any, any, any>) =>
  Served.pipe(Layer.provide(SqlSpanSink), Layer.provide(Layer.succeed(CoreIdentity, IDENTITY)), Layer.provideMerge(deps));

let traces = 0;
/** The headers of one call as `person` (or the owner), with a trace of its own. */
export const headersOf = (person: string | null) => {
  traces += 1;
  const trace = Str.padStart(32, "0")(traces.toString(16));
  return {
    trace,
    headers: {
      [CREDENTIAL_HEADER]: "Bearer door-token",
      [TRACE_HEADER]: `00-${trace}-${Str.repeat(16)("1")}-01`,
      ...(person === null ? {} : { [PERSON_HEADER]: person }),
    },
  };
};

export const client = RpcTest.makeClient(CoreRpcs);

/** Applies the SQL files, in order, to the world's database. */
export const migrate = (files: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    yield* sql.unsafe("drop schema if exists app cascade");
    // One statement at a time: the driver's extended protocol takes one per query.
    for (const text of files)
      for (const statement of Arr.filter(Str.split(text, /;\s*\n/), (each) => Str.trim(Str.replace(/--[^\n]*/g, "")(each)) !== ""))
        yield* sql.unsafe(statement);
  });

const roleKey = (name: string) => padHex(stringToHex(name), { dir: "right", size: 32 });

/** Makes the cast: claims each Safe through Companies House and funds it with 10,000 USDC from the faucet. */
export const makeCast = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  for (const [position, each] of Arr.map(CAST, (member, i) => [i, member] as const)) {
    const email = `${each.person}@cast.test`;
    const signer = keyOf(each.person).address;
    let safe: string | null = null;
    if (each.safe) {
      const claim = encodeFunctionData({ abi: CLAIMER, functionName: "claim", args: [TIER.personalNamespace, email, signer] });
      yield* sendAsService(
        SEEDED.companiesHouseRoles,
        encodeFunctionData({ abi: ROLES, functionName: "execTransactionWithRole", args: [SEEDED.claimer, 0n, claim, 1, roleKey(TIER.claimRole), true] }),
      );
      safe = yield* readContract({
        address: SEEDED.claimer,
        abi: CLAIMER,
        functionName: "safeAddressFor",
        args: [SEEDED.companiesHouse, TIER.personalNamespace, email],
      });
      yield* sendAsService(SEEDED.usdc, encodeFunctionData({ abi: MINT, functionName: "mint", args: [safe as Hex, 10_000_000_000n] }), 200_000n);
    }
    yield* sql`insert into app.cast ${sql.insert({ person: each.person, position, email, signer, safe })}`;
  }
});
